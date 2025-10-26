import { Result } from '../dto/result';

export type PlayerId = string;
export type PlayRoomId = string;
export type GameId = string;

export enum CardColor {
  RED = 'red',
  YELLOW = 'yellow',
  GREEN = 'green',
  BLUE = 'blue',
}

export interface Card {
  color: CardColor
  value: number
}

export interface Hand {
  playerId: string,
  cards: Card[],
}

export class Deck {
  private deck: Card[];
  private bat: Card[];

  constructor(
    deck: Card[],
    bat: Card[],
  ) {
    this.deck = deck;
    this.bat = bat;
  }

  get top(): Card | undefined {
    return this.bat[this.bat.length - 1];
  }

  get inited() {
    return Boolean(this.top);
  }

  init(hands: Hand[]): Result<void> {
    if (this.inited) {
      return { success: false, reason: 'Deck already dealed' };
    }

    this.deck = this.buildDeck();
    this.shuffleCards(this.deck);

    for (const h of hands) {
      for (let i = 0; i < 7; i++) {
        const res = this.draw();
        if (!res.success) {
          return { success: false, reason: 'Not enough cards for all players' };
        }
        h.cards.push(res.result!);
      }
    }

    const res = this.draw();
    if (!res.success) {
      return { success: false, reason: 'Not enough cards for all players' };
    }
    this.bat = [res.result!];

    return { success: true, reason: '' };
  }

  toBat(card: Card) {
    this.bat.push(card);
  }

  draw(): Result<Card> {
    if (this.deck.length === 0) {
      if (this.bat.length <= 1) {
        return { success: false, reason: 'Not enough cards, can not draw' };
      }
      const top = this.bat.pop()!;
      this.deck = this.bat.splice(0);
      this.shuffleCards(this.deck);
      this.bat = [top];
    }

    return {
      success: true,
      reason: '',
      result: this.deck.pop()!,
    };
  }

  private buildDeck() {
    const deck: Card[] = [];
    for (const color of Object.values(CardColor)) {
      deck.push({ color, value: 0 });
      // two of 1-9
      for (let v = 1; v <= 9; v++) {
        deck.push({ color, value: v });
        deck.push({ color, value: v });
      }
    }

    return deck;
  }

  private shuffleCards(cards: Card[]) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }
}

// TODO: add normal types instead of literals

/**
 * Game is responsible for uno game invariants
**/
// TODO: fix prop modifers
export class Game {
  constructor(
    readonly id: GameId,
    public prevHandIdx: number,
    public currentHandIdx: number,
    readonly deck: Deck,
    readonly hands: Hand[],
  ) {
    // TODO: inforce invariants
    // when deck not inited we expect currenthandIdx to be 0 and empty hands
    // otherwise we expect hands to be not empty
    if (!this.deck.inited) {
      this.prevHandIdx = -1;
      this.currentHandIdx = 0;
    }
  }

  get started() {
    return this.deck.inited;
  }

  get playerIds(): PlayerId[] {
    return this.hands.map((h) => h.playerId);
  }

  get totalPlayers(): number {
    return this.hands.length;
  }

  addPlayers(ids: PlayerId[]): Result<void> {
    if (this.started) {
      return { success: false, reason: 'Game already started, can not add new players' };
    }
    for (const id of ids) {
      const existing = this.hands.find((h) => h.playerId === id);
      if (existing) {
        return { success: false, reason: 'Player with this id already added to the game' };
      }
      this.hands.push({ playerId: id, cards: [] });
    }

    return { success: true, reason: '' };
  }

  start(): Result<void> {
    if (this.hands.length < 2) {
      return { success: false, reason: 'Not enough players to start the game' };
    }

    return this.deck.init(this.hands);
  }

  getPlayerHand(userId: PlayerId): Hand | undefined {
    return this.hands.find((h) => h.playerId === userId);
  }

  drawCard(userId: PlayerId): Result<{
    nextPlayerId: PlayerId,
    card?: Card,
    canPlayDrawnCard: boolean
  }> {
    if (!this.started) {
      return { success: false, reason: 'Game has not started yet' };
    }
    const handIdx = this.hands.findIndex((h) => h.playerId === userId);
    if (handIdx === -1) {
      return { success: false, reason: 'You are not part of this game' };
    }
    if (handIdx !== this.currentHandIdx) {
      return { success: false, reason: 'It is not your turn right now' };
    }

    this.prevHandIdx = this.currentHandIdx;

    // if deck is drained, just process to next player
    const res = this.deck.draw();
    if (!res.success) {
      this.currentHandIdx = (this.currentHandIdx + 1) % this.hands.length;
      const nextPlayerId = this.hands[this.currentHandIdx].playerId;

      return {
        success: true,
        reason: '',
        result: {
          nextPlayerId,
          canPlayDrawnCard: false,
        },
      };
    }

    const hand = this.hands[handIdx];
    const card = res.result!;

    hand.cards.push(card);
    const canPlayDrawnCard = this.canPlayCardOnTop(this.deck.top!, card);
    if (!canPlayDrawnCard) {
      this.currentHandIdx = (this.currentHandIdx + 1) % this.hands.length;
    }
    const nextPlayerId = this.hands[this.currentHandIdx].playerId;

    return {
      success: true,
      reason: '',
      result: {
        card,
        nextPlayerId,
        canPlayDrawnCard,
      },
    };
  }

  keepDrawnPlayableCard(userId: PlayerId): Result<{ nextPlayerId: PlayerId }> {
    if (!this.started) {
      return { success: false, reason: 'Game has not started yet' };
    }
    const handIdx = this.hands.findIndex((h) => h.playerId === userId);
    if (handIdx === -1) {
      return { success: false, reason: 'You are not part of this game' };
    }
    if (handIdx !== this.currentHandIdx) {
      return { success: false, reason: 'It is not your turn right now' };
    }
    if (this.prevHandIdx !== this.currentHandIdx) {
      return { success: false, reason: 'You are not allowed to do this action' };
    }

    this.prevHandIdx = this.currentHandIdx;
    this.currentHandIdx = (this.currentHandIdx + 1) % this.hands.length;

    return {
      success: true,
      reason: '',
      result: { nextPlayerId: this.hands[this.currentHandIdx].playerId },
    };
  }

  playCard(userId: PlayerId, card?: Card): Result<{ finished: boolean, playedCard: Card, nextPlayerId?: PlayerId }> {
    if (!this.started) {
      return { success: false, reason: 'Game has not started yet' };
    }

    const handIdx = this.hands.findIndex((h) => h.playerId === userId);
    if (handIdx === -1) {
      return { success: false, reason: 'You are not part of this game' };
    }
    if (handIdx !== this.currentHandIdx) {
      return { success: false, reason: 'It is not your turn right now' };
    }
    const hand = this.hands[handIdx];

    let cardIdx: number;
    if (!card && this.prevHandIdx === this.currentHandIdx) {
      cardIdx = hand.cards.length - 1;
    } else if (card && this.prevHandIdx !== this.currentHandIdx) {
      cardIdx = hand.cards.findIndex((c) => c.color === card.color && c.value === card.value);
    } else {
      return { success: false, reason: 'You can not play this card right now' };
    }

    if (cardIdx === -1) {
      return { success: false, reason: 'You do not have this card in your hand' };
    }

    const handCard = hand.cards[cardIdx];
    if (!this.canPlayCardOnTop(this.deck.top!, handCard)) {
      return { success: false, reason: 'You can not play this card' };
    }

    hand.cards.splice(cardIdx, 1);
    this.deck.toBat(handCard);
    this.prevHandIdx = this.currentHandIdx;
    this.currentHandIdx = (this.currentHandIdx + 1) % this.hands.length;

    if (hand.cards.length === 0) {
      return { success: true, reason: '', result: { finished: true, playedCard: handCard } };
    }

    const nextPlayerId = this.hands[this.currentHandIdx].playerId;

    return { success: true, reason: '', result: { finished: false, playedCard: handCard, nextPlayerId } };
  }

  private canPlayCardOnTop(top: Card, card: Card): boolean {
    return top.color === card.color || top.value === card.value;
  }
}

/**
 * PlayRoom is responsible for game managment via room owner
 * In general it is responsible for future game participants managment
 * and set of rules for the room itself and future game
**/
interface PlayRoomSettings {
  maxParticipants: number
}

// TODO: fix prop modifiers
export class PlayRoom {
  id: PlayRoomId;
  ownerId: PlayerId;
  participants: PlayerId[];
  runningGameId?: GameId;
  settings: PlayRoomSettings;

  constructor(
    id: string,
    ownerId: string,
    settings: PlayRoomSettings,
    participants?: PlayerId[],
    runningGameId?: string,
  ) {
    this.id = id;
    this.ownerId = ownerId;
    this.settings = settings;
    this.participants = participants ?? [];
    this.runningGameId = runningGameId;
  }

  addParticipant(id: PlayerId): Result<void> {
    if (this.participants.length >= this.settings.maxParticipants) {
      return { success: false, reason: 'Reach max room participants number' };
    }
    if (this.runningGameId) {
      return { success: false, reason: 'Game in this room already started' };
    }
    if (this.participants.includes(id)) {
      return { success: false, reason: 'You are already in this room' };
    }

    this.participants.push(id);

    return { success: true, reason: '' };
  }

  removeParticipant(id: PlayerId): Result<void> {
    if (this.runningGameId) {
      return { success: false, reason: 'You can not leave room while game is running' };
    }

    if (id === this.ownerId) {
      return { success: false, reason: 'You are owner of this room, you can not leave it' };
    }

    if (!this.participants.includes(id)) {
      return { success: false, reason: 'You are not mamber of this room' };
    }
    this.participants = this.participants.filter((p) => p !== id);

    return { success: true, reason: '' };
  }

  canBeDeleted(id: PlayerId): Result<void> {
    if (this.ownerId !== id) {
      return { success: false, reason: 'only room owner can delete room' };
    }
    if (this.runningGameId) {
      return { success: false, reason: 'you can not delete room while game is running' };
    }

    return { success: true, reason: '' };
  }

  canStartGame(id: PlayerId): Result<void> {
    if (this.runningGameId) {
      return { success: false, reason: 'Game is this room already running' };
    }
    if (this.ownerId !== id) {
      return { success: false, reason: 'Only owner of the room can start game' };
    }

    return { success: true, reason: '' };
  }
}
