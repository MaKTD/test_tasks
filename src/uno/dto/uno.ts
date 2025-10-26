import { PlayerId, PlayRoomId } from '../core/uno';

export interface PlayRoomOverview {
  id: PlayRoomId;
  ownerId: PlayerId;
  totalParticipants: number;
  gameIsRunning: boolean;
}
