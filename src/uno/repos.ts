import {
  Game,
  GameId,
  PlayerId,
  PlayRoom,
  PlayRoomId,
} from './core/uno';
import { PlayRoomOverview } from './dto/uno';

export interface RoomsRepo {
  create(room: PlayRoom): Promise<void>
  delete(room: PlayRoom): Promise<boolean>
  totalOwningRooms(userId: string): Promise<number>
  byId(id: PlayRoomId): Promise<PlayRoom | null>
  addParticipantOrIgnore(id: PlayRoomId, userId: PlayerId): Promise<boolean>
  removeParticipantOrIgnore(id: PlayRoomId, userId: PlayerId): Promise<boolean>
  allParticipatesIn(userId: PlayerId): Promise<PlayRoomOverview>
  participatesIn(userId: PlayerId, roomId: PlayRoomId): Promise<boolean>
  assignGameId(roomId: PlayRoomId, gameId?: GameId): Promise<boolean>
  runningGameId(roomId: PlayRoomId): Promise<GameId | undefined>
}

export interface GamesRepo {
  createOrIgnore(game: Game): Promise<boolean>
  update(game: Game): Promise<boolean>
  delete(game: Game): Promise<boolean>
  byId(id: GameId): Promise<Game | null>
}

export interface UsersRepo {
  currentRoom(userId: PlayerId): Promise<PlayRoomId | undefined>
  // if roomId is not defined, then this method should unassign user from current room
  // also in this case method should always return true, the caller will expect unusign to be always succesfull
  reasignCurrentRoom(userId: PlayerId, roomId?: PlayRoomId): Promise<boolean>
}

