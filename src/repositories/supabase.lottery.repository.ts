import { supabase } from '@/lib/supabase'
import { Room, Prize, Participant, CreateRoomData } from '@/types'
import { LotteryRepository } from './lottery.repository'

export class SupabaseLotteryRepository implements LotteryRepository {
  async createRoom(data: CreateRoomData): Promise<Room> {
    // TODO: Implement room creation
    throw new Error('Not implemented')
  }

  async getRoom(id: string): Promise<Room | null> {
    // TODO: Implement get room
    throw new Error('Not implemented')
  }

  async getRoomByPublicId(publicId: string): Promise<Room | null> {
    // TODO: Implement get room by public ID
    throw new Error('Not implemented')
  }

  async getRoomBySecretId(secretId: string): Promise<Room | null> {
    // TODO: Implement get room by secret ID
    throw new Error('Not implemented')
  }

  async updateRoom(id: string, data: Partial<Room>): Promise<Room> {
    // TODO: Implement update room
    throw new Error('Not implemented')
  }

  async deleteRoom(id: string): Promise<void> {
    // TODO: Implement delete room
    throw new Error('Not implemented')
  }

  async addPrize(roomId: string, name: string, description?: string, order?: number): Promise<Prize> {
    // TODO: Implement add prize
    throw new Error('Not implemented')
  }

  async getPrizes(roomId: string): Promise<Prize[]> {
    // TODO: Implement get prizes
    throw new Error('Not implemented')
  }

  async updatePrize(id: string, data: Partial<Prize>): Promise<Prize> {
    // TODO: Implement update prize
    throw new Error('Not implemented')
  }

  async deletePrize(id: string): Promise<void> {
    // TODO: Implement delete prize
    throw new Error('Not implemented')
  }

  async addParticipant(roomId: string, name: string): Promise<Participant> {
    // TODO: Implement add participant
    throw new Error('Not implemented')
  }

  async getParticipants(roomId: string): Promise<Participant[]> {
    // TODO: Implement get participants
    throw new Error('Not implemented')
  }

  async updateParticipant(id: string, data: Partial<Participant>): Promise<Participant> {
    // TODO: Implement update participant
    throw new Error('Not implemented')
  }

  subscribeToRoom(roomId: string, callback: (room: Room) => void): () => void {
    // TODO: Implement realtime subscription to room
    return () => {}
  }

  subscribeToPrizes(roomId: string, callback: (prizes: Prize[]) => void): () => void {
    // TODO: Implement realtime subscription to prizes
    return () => {}
  }

  subscribeToParticipants(roomId: string, callback: (participants: Participant[]) => void): () => void {
    // TODO: Implement realtime subscription to participants
    return () => {}
  }
}

export const lotteryRepository = new SupabaseLotteryRepository()
