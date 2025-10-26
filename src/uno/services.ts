import {
  Card,
  Game,
  PlayerId,
  PlayRoomId,
} from './core/uno';

export interface PlayerNotifier {
  broadcastRoomJoin(
    joinedId: PlayerId,
    to: PlayerId[],
  ): Promise<void>

  broadcastRoomDeleted(
    roomId: PlayRoomId,
    to: PlayerId[],
  ): Promise<void>

  broadcastGameStarted(
    game: Game,
    to: PlayerId[],
  ): Promise<void>

  broadcastGameFinished(
    winnerId: PlayerId,
    playedCard: Card,
    to: PlayerId[],
  ): Promise<void>

  broadcastPlayedCard(
    playerId: PlayerId,
    top: Card,
    playedCard: Card,
    to: PlayerId[],
  ): Promise<void>

  broadcastCardDrawn(
    playerId: PlayerId,
    to: PlayerId[],
  ): Promise<void>

  notifyYourTurn(
    playerId: PlayerId,
  ): Promise<void>

}
