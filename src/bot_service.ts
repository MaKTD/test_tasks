import process from 'node:process';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Context, Telegraf } from 'telegraf';
import { botConfig } from './config';

type Color = 'red' | 'yellow' | 'green' | 'blue';

interface Card {
  color: Color
  value: number
}

interface Player {
  id: number // telegram user id
  username?: string
  hand: Card[]
}

interface Room {
  id: string
  players: Player[] // max 2 for this simplified implementation
  deck: Card[]
  discard: Card[]
  currentPlayerIdx: number // index in players
  playableDrawnCardIdx: number
  gameStarted: boolean
}

@Injectable()
export class BotService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private rooms = new Map<string, Room>();

  private logger = new Logger(BotService.name);

  private bot: Telegraf;

  private controller = new AbortController();

  constructor(
    @Inject(botConfig.KEY) private conf: ConfigType<typeof botConfig>,
  ) {
    this.bot = new Telegraf(this.conf.secretKey, { telegram: { testEnv: this.conf.testEnv } });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.bot.command('start', async (ctx) => this.handleStart(ctx));
    this.bot.command('rooms', async (ctx) => this.listRooms(ctx));
    this.bot.command('hand', async (ctx) => this.listHand(ctx));
    this.bot.command('create', async (ctx) => this.createRoom(ctx));
    this.bot.command('join', async (ctx) => this.joinRoom(ctx));
    this.bot.command('start', async (ctx) => this.startGame(ctx));
    this.bot.command('status', async (ctx) => this.playerStatus(ctx));
    this.bot.command('play', async (ctx) => this.playCard(ctx));
    this.bot.command('draw', async (ctx) => this.drawCard(ctx));
    this.bot.command('help', async (ctx) => this.helpMsg(ctx));

    this.bot.launch()
      .catch((err) => this.logger.error({ err }, 'unexpected error on tg bot running'))
      .finally(() => {
        if (!this.controller.signal.aborted) {
          this.logger.warn('tg bot unexpectedly stop running, the application will be shutdown');
          process.kill(process.pid, 'SIGTERM');
        }
      });

    this.logger.log('bot was launched');
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.logger.log('start shutting down TgBotService');
    this.bot.stop('shutdown');
    this.controller.abort('shutdown');
    this.logger.log('finish shutting down TgBotService, task queue cleared');
  }

  private async handleStart(ctx: Context) {
    await ctx.reply('simple uno game');
  }

  private async createRoom(ctx: Context) {
    const user = ctx.from!;
    const room = this.buildRoom(user.id, user.username);
    await ctx.reply(`Room created: ${room.id}\nShare this id with one friend who will /join ${room.id}`);
  }

  private async joinRoom(ctx: Context) {
    // @ts-ignore
    const args = (ctx.message.text as unknown as string).split(' ').slice(1);
    if (args.length === 0) return ctx.reply('Usage: /join <ROOM_ID>');
    const roomId = args[0].toUpperCase();
    const room = this.rooms.get(roomId);
    if (!room) return ctx.reply('No such room');
    if (room.gameStarted) return ctx.reply('Game already started');
    if (room.players.find((p) => p.id === ctx.from!.id)) return ctx.reply('You are already in the room');
    if (room.players.length >= 2) return ctx.reply('Room is full (max 2 players)');
    room.players.push({ id: ctx.from!.id, username: ctx.from!.username, hand: [] });
    await ctx.reply(`Joined room ${roomId}`);
    // notify other player
    const other = room.players.find((p) => p.id !== ctx.from!.id);
    if (other) {
      await this.bot.telegram.sendMessage(other.id, `${ctx.from!.username || ctx.from!.id} joined your room ${roomId}`);
    }
  }

  private async startGame(ctx: Context) {
    // find room where this user is the creator or participant
    const room = Array.from(this.rooms.values()).find((r) => r.players.some((p) => p.id === ctx.from!.id));
    if (!room) return ctx.reply('You are not in any room. Create one with /create');
    if (room.gameStarted) return ctx.reply('Game already started');
    if (room.players.length < 2) return ctx.reply('Need 2 players to start');

    room.gameStarted = true;
    this.dealInitial(room);

    // send each player their hand privately
    for (const p of room.players) {
      this.bot.telegram.sendMessage(p.id, `Game ${room.id} started! Your hand:\n${this.handToString(p.hand)}`).catch((err) => this.logger.error({ err }, 'failed to send msg'));
    }

    const top = room.discard[room.discard.length - 1];
    // eslint-disable-next-line max-len
    this.broadcastToPlayers(room, `Game started! Top card: ${this.cardToString(top)}\nIt's ${room.players[room.currentPlayerIdx].username || room.players[room.currentPlayerIdx].id}'s turn. Use /play <index> or /draw`);
  }

  private async playCard(ctx: Context) {
    const room = Array.from(this.rooms.values()).find((r) => r.players.some((p) => p.id === ctx.from!.id));
    if (!room) return ctx.reply('You are not in any room');
    if (!room.gameStarted) return ctx.reply('Game not started yet');
    const playerIndex = room.players.findIndex((p) => p.id === ctx.from!.id);
    if (playerIndex !== room.currentPlayerIdx) return ctx.reply('Not your turn');
    const player = room.players[playerIndex];

    let idx: number;
    if (room.playableDrawnCardIdx >= 0) {
      idx = room.playableDrawnCardIdx;
      room.playableDrawnCardIdx = -1;
    } else {
      // @ts-ignore
      const args = ctx.message!.text.split(' ').slice(1);
      if (args.length === 0) return ctx.reply('Usage: /play <hand_index>');
      idx = Number(args[0]);
    }

    if (Number.isNaN(idx)) return ctx.reply('Index must be a number');

    const top = room.discard[room.discard.length - 1];

    const hasPlayableCard = player.hand.some((c) => this.isCardPlayable(top, c));
    if (!hasPlayableCard) {
      ctx.reply('You don\'t have playable card, you have to draw').catch((err) => this.logger.error({ err }, 'failed to send msg'));

      return;
    }

    if (idx < 0 || idx >= player.hand.length) return ctx.reply('Invalid index');
    const played = player.hand[idx];
    if (!this.isCardPlayable(top, played)) {
      ctx.reply(`Can't play ${this.cardToString(played)} on ${this.cardToString(top)}`).catch((err) => this.logger.error({ err }, 'failed to send msg'));
    }

    // play it
    player.hand.splice(idx, 1);
    room.discard.push(played);

    this.broadcastToPlayers(room, `${player.username || player.id} played ${this.cardToString(played)}.`);

    // check win
    if (player.hand.length === 0) {
      this.broadcastToPlayers(room, `${player.username || player.id} wins! Game over.`);
      this.rooms.delete(room.id);

      return;
    }

    // advance turn
    room.currentPlayerIdx = (room.currentPlayerIdx + 1) % room.players.length;
    const next = room.players[room.currentPlayerIdx];
    this.broadcastToPlayers(room, `Top is now ${this.cardToString(room.discard[room.discard.length - 1])}. It's ${next.username || next.id}'s turn.`);
    // send updated hands
    for (const p of room.players) {
      this.bot.telegram.sendMessage(p.id, `Your hand:\n${this.handToString(p.hand)}`).catch((err) => this.logger.error({ err }, 'failed to send msg'));
    }
  }

  private async drawCard(ctx: Context) {
    const room = Array.from(this.rooms.values()).find((r) => r.players.some((p) => p.id === ctx.from!.id));
    if (!room) return ctx.reply('You are not in any room');
    if (!room.gameStarted) return ctx.reply('Game not started');
    const playerIndex = room.players.findIndex((p) => p.id === ctx.from!.id);
    if (playerIndex !== room.currentPlayerIdx) return ctx.reply('Not your turn');
    const player = room.players[playerIndex];

    if (room.playableDrawnCardIdx >= 0) {
      room.currentPlayerIdx = (room.currentPlayerIdx + 1) % room.players.length;
      const next = room.players[room.currentPlayerIdx];
      this.broadcastToPlayers(room, `It's now ${next.username || next.id}'s turn.`);

      return;
    }

    const card = this.drawCardFromRoomDeck(room);
    if (!card) {
      this.broadcastToPlayers(room, 'No cards left to draw');
      if (room.players[0].hand.length > room.players[1].hand.length) {
        this.broadcastToPlayers(room, `player ${room.players[1].username || room.players[0].id} win. Game over`);
      } else if (room.players[0].hand.length < room.players[1].hand.length) {
        this.broadcastToPlayers(room, `player ${room.players[0].username || room.players[1].id} win. Game over`);
      } else {
        this.broadcastToPlayers(room, 'Parity. Game over');
      }
      this.rooms.delete(room.id);

      return;
    }

    player.hand.push(card);
    this.bot.telegram.sendMessage(player.id, `You drew: ${this.cardToString(card)}\nYour hand:\n${this.handToString(player.hand)}`)
      .catch((err) => this.logger.error({ err }, 'failed to send msg'));

    this.broadcastToPlayers(room, `${player.username || player.id} drew a card.`);

    //TODO: if card playable current player can optionally play the it
    const top = room.discard[room.discard.length - 1];
    if (this.isCardPlayable(top, card)) {
      ctx.reply('you can play drawn card, send /play without argument or /draw without argument to play now or skip')
        .catch((err) => this.logger.error({ err }, 'failed to send msg'));

      room.playableDrawnCardIdx = player.hand.length - 1;

      return;
    }

    // After drawing, turn passes
    room.currentPlayerIdx = (room.currentPlayerIdx + 1) % room.players.length;
    const next = room.players[room.currentPlayerIdx];
    this.broadcastToPlayers(room, `It's now ${next.username || next.id}'s turn.`);
  }

  private buildRoom(ownerId: number, username?: string): Room {
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    const room: Room = {
      id,
      players: [{ id: ownerId, username, hand: [] }],
      deck: [],
      discard: [],
      currentPlayerIdx: 0,
      playableDrawnCardIdx: -1,
      gameStarted: false,
    };
    this.rooms.set(id, room);

    return room;
  }

  private dealInitial(room: Room) {
    room.deck = this.buildDeck();

    for (let p = 0; p < room.players.length; p++) {
      const player = room.players[p];
      for (let i = 0; i < 7; i++) {
        const c = this.drawCardFromRoomDeck(room);
        if (c) player.hand.push(c);
      }
    }

    // put top discard ensuring it's a number card (we only have number cards)
    let top = this.drawCardFromRoomDeck(room);
    if (!top) throw new Error('Deck empty');
    room.discard.push(top);
  }

  private cardToString(c: Card) {
    return `${c.color[0].toUpperCase()}${c.value}`;
  }

  private handToString(hand: Card[]) {
    return hand.map((c, i) => `${i}: ${this.cardToString(c)}`).join('\n');
  }

  private isCardPlayable(top: Card, candidate: Card): boolean {
    return top.color === candidate.color || top.value === candidate.value;
  }

  private async playerStatus(ctx: Context) {
    const room = Array.from(this.rooms.values()).find((r) => r.players.some((p) => p.id === ctx.from!.id));
    if (!room) return ctx.reply('You are not in any room');
    const top = room.discard[room.discard.length - 1];
    const cur = room.players[room.currentPlayerIdx];
    ctx.reply(`Room ${room.id}\nTop: ${this.cardToString(top)}\nTurn: ${cur.username || cur.id}`)
      .catch((err) => this.logger.error({ err }, 'failed to send msg'));
  }

  private async listRooms(ctx: Context) {
    const list = Array.from(this.rooms.values()).map((r) => `${r.id}: players=${r.players.length} started=${r.gameStarted}`).join('\n');
    ctx.reply(`Rooms:\n${list || '(none)'}`)
      .catch((err) => this.logger.error({ err }, 'failed to send msg'));
  }

  private async listHand(ctx: Context) {
    const room = Array.from(this.rooms.values()).find((r) => r.players.some((p) => p.id === ctx.from!.id));
    if (!room) return ctx.reply('You are not in any room');
    const player = room.players.find((p) => p.id === ctx.from!.id)!;
    ctx.reply(`Your hand:\n${this.handToString(player.hand)}`).catch((err) => this.logger.error({ err }, 'failed to send msg'));
  }

  private async helpMsg(ctx: Context) {
    ctx.reply('Welcome to UNO-2p bot! commands: /create /join <id> /start /status /hand /play <idx> /draw').catch((err) => this.logger.error({ err }, 'failed to send msg'));
  }

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
  }

  private buildDeck(): Card[] {
    const colors: Color[] = ['red', 'yellow', 'green', 'blue'];
    const deck: Card[] = [];
    for (const color of colors) {
    // one 0
      deck.push({ color, value: 0 });
      // two of 1-9
      for (let v = 1; v <= 9; v++) {
        deck.push({ color, value: v });
        deck.push({ color, value: v });
      }
    }

    return deck;
  }

  private drawCardFromRoomDeck(room: Room): Card | null {
    if (room.deck.length === 0) {
      // reshuffle discard minus top
      // theoritally this is possible state
      if (room.discard.length <= 1) return null;
      const top = room.discard.pop()!;
      room.deck = this.shuffle(room.discard.splice(0));
      room.discard = [top];
    }

    return room.deck.pop() || null;
  }

  private broadcastToPlayers(room: Room, text: string) {
    for (const pl of room.players) {
      this.bot.telegram.sendMessage(pl.id, text).catch((e) => this.logger.warn('sendMessage fail', e));
    }
  }

}
