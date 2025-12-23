// Database row <-> Application type mappers
// Transforms between snake_case database fields and camelCase application fields

import type {
  RoomRow,
  PrizeRow,
  ParticipantRow,
  RoomInsert,
  PrizeInsert,
  ParticipantInsert,
} from '@/types/database'
import type { Room, Prize, Participant, CreateRoomData } from '@/types'

/**
 * Converts database RoomRow to application Room type
 */
export function mapRoomFromDb(row: RoomRow): Room {
  return {
    id: row.id,
    publicId: row.public_id,
    secretId: row.secret_id,
    name: row.name,
    registrationOpen: row.registration_open,
    status: row.status,
    currentPrizeIndex: row.current_prize_index,
    settings: row.settings,
    createdAt: new Date(row.created_at),
  }
}

/**
 * Converts database PrizeRow to application Prize type
 */
export function mapPrizeFromDb(row: PrizeRow): Prize {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    description: row.description ?? undefined,
    sortOrder: row.sort_order,
    winnerId: row.winner_id ?? undefined,
    createdAt: new Date(row.created_at),
  }
}

/**
 * Converts database ParticipantRow to application Participant type
 */
export function mapParticipantFromDb(row: ParticipantRow): Participant {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    hasWon: row.has_won,
    prizeId: row.prize_id ?? undefined,
    joinedAt: new Date(row.joined_at),
  }
}

/**
 * Converts CreateRoomData to database RoomInsert type
 */
export function mapRoomToDb(data: CreateRoomData, publicId: string): RoomInsert {
  return {
    public_id: publicId,
    name: data.name,
    settings: {
      gameType: data.settings?.gameType ?? 'classic',
      visualization: data.settings?.visualization ?? 'name-reveal',
      theme: data.settings?.theme ?? 'new-year',
      prizeOrder: data.settings?.prizeOrder ?? 'small-to-large',
    },
  }
}

/**
 * Converts Prize data to database PrizeInsert type
 */
export function mapPrizeToDb(
  roomId: string,
  name: string,
  sortOrder: number,
  description?: string
): PrizeInsert {
  return {
    room_id: roomId,
    name,
    description,
    sort_order: sortOrder,
  }
}

/**
 * Converts Participant data to database ParticipantInsert type
 */
export function mapParticipantToDb(roomId: string, name: string): ParticipantInsert {
  return {
    room_id: roomId,
    name,
  }
}
