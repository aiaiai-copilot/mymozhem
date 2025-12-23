import { supabase } from '@/lib/supabase'
import { Room, Prize, Participant, CreateRoomData } from '@/types'
import type { RoomRow, PrizeRow, ParticipantRow, RoomUpdate, PrizeUpdate, ParticipantUpdate } from '@/types/database'
import {
  mapRoomFromDb,
  mapPrizeFromDb,
  mapParticipantFromDb,
  mapRoomToDb,
  mapPrizeToDb,
  mapParticipantToDb
} from '@/lib/mappers'
import { LotteryRepository } from './lottery.repository'

export class SupabaseLotteryRepository implements LotteryRepository {
  /**
   * Generate unique public_id in format NY2025-XXX
   */
  private async generatePublicId(): Promise<string> {
    const prefix = 'NY2025'
    const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase()
    const publicId = `${prefix}-${randomSuffix}`

    // Check uniqueness
    const { data } = await supabase
      .from('rooms')
      .select('id')
      .eq('public_id', publicId)
      .maybeSingle()

    // Retry if collision (unlikely but possible)
    if (data) {
      return this.generatePublicId()
    }

    return publicId
  }

  async createRoom(data: CreateRoomData): Promise<Room> {
    const publicId = await this.generatePublicId()
    const insertData = mapRoomToDb(data, publicId)

    const { data: row, error } = await supabase
      .from('rooms')
      .insert(insertData)
      .select()
      .single()

    if (error) throw new Error(`Failed to create room: ${error.message}`)

    return mapRoomFromDb(row as RoomRow)
  }

  async getRoom(id: string): Promise<Room | null> {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new Error(`Failed to get room: ${error.message}`)
    if (!data) return null

    return mapRoomFromDb(data as RoomRow)
  }

  async getRoomByPublicId(publicId: string): Promise<Room | null> {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('public_id', publicId)
      .maybeSingle()

    if (error) throw new Error(`Failed to get room by public ID: ${error.message}`)
    if (!data) return null

    return mapRoomFromDb(data as RoomRow)
  }

  async getRoomBySecretId(secretId: string): Promise<Room | null> {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('secret_id', secretId)
      .maybeSingle()

    if (error) throw new Error(`Failed to get room by secret ID: ${error.message}`)
    if (!data) return null

    return mapRoomFromDb(data as RoomRow)
  }

  async updateRoom(id: string, updates: Partial<Room>): Promise<Room> {
    // Convert camelCase to snake_case for database
    const dbUpdates: RoomUpdate = {}

    if (updates.name !== undefined) dbUpdates.name = updates.name
    if (updates.registrationOpen !== undefined) dbUpdates.registration_open = updates.registrationOpen
    if (updates.status !== undefined) dbUpdates.status = updates.status
    if (updates.currentPrizeIndex !== undefined) dbUpdates.current_prize_index = updates.currentPrizeIndex
    if (updates.settings !== undefined) dbUpdates.settings = updates.settings

    const { data, error } = await supabase
      .from('rooms')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update room: ${error.message}`)

    return mapRoomFromDb(data as RoomRow)
  }

  async deleteRoom(id: string): Promise<void> {
    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', id)

    if (error) throw new Error(`Failed to delete room: ${error.message}`)
  }

  async addPrize(roomId: string, name: string, description?: string, order?: number): Promise<Prize> {
    // If no order specified, get max sort_order + 1
    let sortOrder = order ?? 0

    if (order === undefined) {
      const { data: prizes } = await supabase
        .from('prizes')
        .select('sort_order')
        .eq('room_id', roomId)
        .order('sort_order', { ascending: false })
        .limit(1)

      sortOrder = prizes && prizes.length > 0 ? (prizes[0].sort_order + 1) : 1
    }

    const insertData = mapPrizeToDb(roomId, name, sortOrder, description)

    const { data: row, error } = await supabase
      .from('prizes')
      .insert(insertData)
      .select()
      .single()

    if (error) throw new Error(`Failed to add prize: ${error.message}`)

    return mapPrizeFromDb(row as PrizeRow)
  }

  async getPrizes(roomId: string): Promise<Prize[]> {
    const { data, error } = await supabase
      .from('prizes')
      .select('*')
      .eq('room_id', roomId)
      .order('sort_order', { ascending: true })

    if (error) throw new Error(`Failed to get prizes: ${error.message}`)

    return (data as PrizeRow[]).map(mapPrizeFromDb)
  }

  async updatePrize(id: string, updates: Partial<Prize>): Promise<Prize> {
    // Convert camelCase to snake_case for database
    const dbUpdates: PrizeUpdate = {}

    if (updates.name !== undefined) dbUpdates.name = updates.name
    if (updates.description !== undefined) dbUpdates.description = updates.description
    if (updates.sortOrder !== undefined) dbUpdates.sort_order = updates.sortOrder
    if (updates.winnerId !== undefined) dbUpdates.winner_id = updates.winnerId

    const { data, error } = await supabase
      .from('prizes')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update prize: ${error.message}`)

    return mapPrizeFromDb(data as PrizeRow)
  }

  async deletePrize(id: string): Promise<void> {
    const { error } = await supabase
      .from('prizes')
      .delete()
      .eq('id', id)

    if (error) throw new Error(`Failed to delete prize: ${error.message}`)
  }

  async addParticipant(roomId: string, name: string): Promise<Participant> {
    const insertData = mapParticipantToDb(roomId, name)

    const { data: row, error } = await supabase
      .from('participants')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      // Check if it's a unique constraint violation
      if (error.code === '23505') {
        throw new Error(`Participant with name "${name}" already exists in this room`)
      }
      throw new Error(`Failed to add participant: ${error.message}`)
    }

    return mapParticipantFromDb(row as ParticipantRow)
  }

  async getParticipants(roomId: string): Promise<Participant[]> {
    const { data, error } = await supabase
      .from('participants')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true })

    if (error) throw new Error(`Failed to get participants: ${error.message}`)

    return (data as ParticipantRow[]).map(mapParticipantFromDb)
  }

  async updateParticipant(id: string, updates: Partial<Participant>): Promise<Participant> {
    // Convert camelCase to snake_case for database
    const dbUpdates: ParticipantUpdate = {}

    if (updates.name !== undefined) dbUpdates.name = updates.name
    if (updates.hasWon !== undefined) dbUpdates.has_won = updates.hasWon
    if (updates.prizeId !== undefined) dbUpdates.prize_id = updates.prizeId

    const { data, error } = await supabase
      .from('participants')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update participant: ${error.message}`)

    return mapParticipantFromDb(data as ParticipantRow)
  }

  subscribeToRoom(roomId: string, callback: (room: Room) => void): () => void {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`
        },
        (payload) => {
          callback(mapRoomFromDb(payload.new as RoomRow))
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }

  subscribeToPrizes(roomId: string, callback: (prizes: Prize[]) => void): () => void {
    const channel = supabase
      .channel(`prizes:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prizes',
          filter: `room_id=eq.${roomId}`
        },
        async () => {
          // Re-fetch all prizes when any change occurs
          const prizes = await this.getPrizes(roomId)
          callback(prizes)
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }

  subscribeToParticipants(roomId: string, callback: (participants: Participant[]) => void): () => void {
    const channel = supabase
      .channel(`participants:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'participants',
          filter: `room_id=eq.${roomId}`
        },
        async () => {
          // Re-fetch all participants when any change occurs
          const participants = await this.getParticipants(roomId)
          callback(participants)
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }
}

export const lotteryRepository = new SupabaseLotteryRepository()
