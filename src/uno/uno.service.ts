import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import {
  Card,
  Deck,
  Game,
  Hand,
  PlayerId,
  PlayRoom,
  PlayRoomId,
} from './core/uno';
import { Result } from './dto/result';
import { PlayRoomOverview } from './dto/uno';
import {
  GamesRepo,
  RoomsRepo,
  UsersRepo,
} from './repos';
import { PlayerNotifier } from './services';
import { unoConfig } from '../config';
import {
  UnoGamesRepo,
  UnoNotifierService,
  UnoRoomsRepo,
  UnoUsersRepo,
} from '../tokens';

// TODO: we should indroduce transactor interface
// do be able to do transational changes and queires
// first of all this is required to prevent race conditions
// additionally this can simiplify logic a little bit

@Injectable()
export class UnoService {
  private logger = new Logger(UnoService.name);

  constructor(
    @Inject(unoConfig.KEY) private unoConf: ConfigType<typeof unoConfig>,
    @Inject(UnoRoomsRepo) private roomsRepo: RoomsRepo,
    @Inject(UnoUsersRepo) private usersRepo: UsersRepo,
    @Inject(UnoGamesRepo) private gamesRepo: GamesRepo,
    @Inject(UnoNotifierService) private notifier: PlayerNotifier,
  ) {}

  async createRoom(
    userId: PlayerId,
  ): Promise<Result<PlayRoomId>> {
    const totalOwningRooms = await this.roomsRepo.totalOwningRooms(userId);
    if (totalOwningRooms > this.unoConf.maxRoomsForOwner) {
      return { success: false, reason: 'You have reached room creation limit' };
    }

    const room = new PlayRoom(
      uuid(),
      userId,
      // in future we should allow owner specify this settings, at lest some of them
      {
        maxParticipants: this.unoConf.maxRoomParticipants,
      },
      [userId], // for now owner always considered to be participant
    );

    await this.roomsRepo.create(room);

    return { success: true, result: room.id, reason: '' };
  }

  async deleteRoom(
    userId: PlayerId,
    roomId: PlayRoomId,
  ): Promise<Result<void>> {
    const room = await this.roomsRepo.byId(roomId);
    if (!room) {
      return { success: false, reason: 'No such room' };
    }

    const res = room.canBeDeleted(userId);
    if (!res.success) {
      return res;
    }

    const deleted = await this.roomsRepo.delete(room);
    if (!deleted) {
      return { success: false, reason: 'Room can not be deleted now' };
    }

    this.notifier.broadcastRoomDeleted(
      room.id,
      room.participants.filter((p) => p !== userId),
    ).catch((err) => this.logger.error({ err }, 'unexpected error on broadcastRoomDeleted'));

    return { success: true, reason: '' };
  }

  async joinRoom(
    userId: PlayerId,
    roomId: PlayRoomId,
  ): Promise<Result<{ wasAssignedToRoom: boolean }>> {
    const room = await this.roomsRepo.byId(roomId);
    if (!room) {
      return { success: false, reason: 'No such room' };
    }

    const res = room.addParticipant(userId);
    if (!res.success) {
      return { success: false, reason: res.reason };
    }
    const added = await this.roomsRepo.addParticipantOrIgnore(roomId, userId);
    if (!added) {
      return { success: false, reason: 'You are already in this room' };
    }

    this.notifier.broadcastRoomJoin(
      userId,
      room.participants.filter((p) => p !== userId),
    ).catch((err) => this.logger.error({ err }, 'unexpected err on broadcastRoomJoin'));

    const currentRoom = await this.usersRepo.currentRoom(userId);
    if (!currentRoom) {
      const assigned = await this.usersRepo.reasignCurrentRoom(userId, roomId);
      if (assigned) {
        return { success: true, reason: '', result: { wasAssignedToRoom: true } };
      }
    }

    return { success: true, reason: '', result: { wasAssignedToRoom: false } };
  }

  async leaveRoom(
    userId: PlayerId,
    roomId: PlayRoomId,
  ): Promise<Result<void>> {
    const room = await this.roomsRepo.byId(roomId);
    if (!room) {
      return { success: false, reason: 'No such room' };
    }
    const res = room.removeParticipant(userId);
    if (!res.success) {
      return res;
    }
    const removed = await this.roomsRepo.removeParticipantOrIgnore(roomId, userId);
    if (!removed) {
      return { success: false, reason: 'You can not leave group right now' };
    }

    return { success: true, reason: '' };
  }

  async enterRoom(
    userId: PlayerId,
    roomId: PlayRoomId,
  ): Promise<Result<void>> {
    const allowed = await this.roomsRepo.participatesIn(userId, roomId);
    if (!allowed) {
      return { success: false, reason: 'You are not allowed to enter this room' };
    }
    const assigned = await this.usersRepo.reasignCurrentRoom(userId, roomId);
    if (!assigned) {
      return { success: false, reason: 'You are already entered this room, or not allowed to enter it anymore' };
    }

    return { success: true, reason: '' };
  }

  async exitRoom(userId: PlayerId): Promise<Result<void>> {
    const currentRoom = await this.usersRepo.currentRoom(userId);
    if (!currentRoom) {
      return { success: false, reason: 'You are not in any room' };
    }
    const room =  await this.roomsRepo.byId(currentRoom);
    // TODO: move to core logic
    if (room && room.runningGameId) {
      return { success: false, reason: 'You can not exit room when game is running' };
    }

    await this.usersRepo.reasignCurrentRoom(userId);

    return { success: true, reason: '' };
  }

  async startGame(
    userId: PlayerId,
    roomId: PlayRoomId,
  ): Promise<Result<void>> {
    const room = await this.roomsRepo.byId(roomId);
    if (!room) {
      return { success: false, reason: 'No such room' };
    }
    let res = room.canStartGame(userId);
    if (!res.success) {
      return res;
    }

    // TODO: object params prefered here
    const game = new Game(
      uuid(),
      -1,
      0,
      new Deck([], []),
      [],
    );
    res = game.addPlayers(room.participants);
    if (!res.success) {
      return res;
    }
    res = game.start();
    if (!res.success) {
      return res;
    }

    // TODO: here me certanly need transactor
    const gameCreated = await this.gamesRepo.createOrIgnore(game);
    if (!gameCreated) {
      return { success: false, reason: 'Game can not be created right now' };
    }
    const gameAssignedToRoom = await this.roomsRepo.assignGameId(room.id, game.id);
    if (!gameAssignedToRoom) {
      return { success: false, reason: 'Game can not be created right now' };
    }

    this.notifier.broadcastGameStarted(
      game,
      game.playerIds.filter((p) => p !== userId),
    ).catch((err) => this.logger.error({ err }, 'unexpected error on broadcastGameStarted'));

    return { success: true, reason: '' };
  }

  async playCard(
    userId: PlayerId,
    card?: Card,
  ): Promise<Result<{ finished: boolean, playedCard: Card, nextPlayerId?: PlayerId }>> {
    const gameRes = await this.getPlayerCurrentGame(userId);
    if (!gameRes.success) {
      return { success: false, reason: gameRes.reason };
    }
    const game = gameRes.result!.game;

    const res = game.playCard(userId, card);
    if (!res.success) {
      return {  success: false, reason: res.reason };
    }

    if (res.result!.finished) {
      // TODO: should be in transaction
      const assigned = await this.roomsRepo.assignGameId(gameRes.result!.currentRoomId);
      if (!assigned) {
        return { success: false, reason: 'Something unexpected happened, try again' };
      }
      const deleted  = await this.gamesRepo.delete(game);
      if (!deleted) {
        return { success: false, reason: 'Something unexpected happened, try again' };
      }
    } else {
      const updated = await this.gamesRepo.update(game);
      if (!updated) {
        return { success: false, reason: 'Something unexpected happened, try again' };
      }
    }

    if (res.result!.finished) {
      this.notifier.broadcastGameFinished(
        userId,
        res.result!.playedCard!,
        game.playerIds.filter((p) => p !== userId),
      ).catch((err) => this.logger.error({ err }, 'unexpected error on broadcastGameEnded'));

      return res;
    }

    this.notifier.broadcastPlayedCard(
      userId,
      game.deck.top!,
      res.result!.playedCard!,
      game.playerIds.filter((p) => p !== userId),
    ).catch((err) => this.logger.error({ err }, 'unexpected error on broadcastPlayedCard'));

    this.notifier.notifyYourTurn(res.result!.nextPlayerId!)
      .catch((err) => this.logger.error({ err }, 'unexpected error on notifyYourTurn'));

    return res;
  }

  async drawCard(userId: PlayerId): Promise<Result<{
    nextPlayerId: PlayerId,
    card?: Card,
    canPlayDrawnCard: boolean
  }>> {
    const gameRes = await this.getPlayerCurrentGame(userId);
    if (!gameRes.success) {
      return { success: false, reason: gameRes.reason };
    }
    const game = gameRes.result!.game;

    const res = game.drawCard(userId);
    if (!res.success) {
      return { success: false, reason: res.reason };
    }

    const updated = await this.gamesRepo.update(game);
    if (!updated) {
      return { success: false, reason: 'Something unexpected happened, try again' };
    }

    if (res.result!.card) {
      this.notifier.broadcastCardDrawn(
        userId,
        game.playerIds.filter((p) => p !== userId),
      ).catch((err) => this.logger.error({ err }, 'unexpected error on broadcastCardDrawn'));
    }

    this.notifier.notifyYourTurn(userId)
      .catch((err) => this.logger.error({ err }, 'unexpected error on notifyYourTurn'));

    return res;
  }

  async getHand(userId: PlayerId): Promise<Result<Hand>> {
    const gameRes = await this.getPlayerCurrentGame(userId);
    if (!gameRes.success) {
      return { success: false, reason: gameRes.reason };
    }
    const game = gameRes.result!.game;
    const hand = game.getPlayerHand(userId);

    if (!hand) {
      return { success: false, reason: 'You are not part of current game' };
    }

    return { success: true, reason: '', result: hand };
  }

  // TODO: add proper pagination,
  // was spipped because higly depend on user interface layer and it's features
  // (was not sure that cursor + limit can be properly supported by tg bot inteface)
  async listKnownRooms(userId: string): Promise<PlayRoomOverview> {
    return this.roomsRepo.allParticipatesIn(userId);
  }

  private async getPlayerCurrentGame(userId: PlayerId): Promise<Result<{ game: Game, currentRoomId: PlayRoomId }>> {
    const currentRoomId = await this.usersRepo.currentRoom(userId);
    if (!currentRoomId) {
      return { success: false, reason: 'You are no playing right now' };
    }
    const gameId = await this.roomsRepo.runningGameId(currentRoomId);
    if (!gameId) {
      return { success: false, reason: 'There is no running game in current room' };
    }
    const game = await this.gamesRepo.byId(gameId);
    if (!game) {
      return { success: false, reason: 'There is no running game in current room' };
    }

    return {
      success: true,
      reason: '',
      result: { game, currentRoomId },
    };
  }
}
