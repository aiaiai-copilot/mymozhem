import { Room, Prize, Participant, CreateRoomData } from '@/types'

export interface LotteryRepository {
  createRoom(data: CreateRoomData): Promise<Room>
  getRoom(id: string): Promise<Room | null>
  getRoomByPublicId(publicId: string): Promise<Room | null>
  getRoomBySecretId(secretId: string): Promise<Room | null>
  updateRoom(id: string, data: Partial<Room>): Promise<Room>
  deleteRoom(id: string): Promise<void>

  addPrize(roomId: string, name: string, description?: string, order?: number): Promise<Prize>
  getPrizes(roomId: string): Promise<Prize[]>
  updatePrize(id: string, data: Partial<Prize>): Promise<Prize>
  deletePrize(id: string): Promise<void>

  addParticipant(roomId: string, name: string): Promise<Participant>
  getParticipants(roomId: string): Promise<Participant[]>
  updateParticipant(id: string, data: Partial<Participant>): Promise<Participant>

  subscribeToRoom(roomId: string, callback: (room: Room) => void): () => void
  subscribeToPrizes(roomId: string, callback: (prizes: Prize[]) => void): () => void
  subscribeToParticipants(roomId: string, callback: (participants: Participant[]) => void): () => void
}
