// Database schema types - exact mappings to Supabase tables
// Generated from: supabase/migrations/20251222000000_initial_schema.sql

/**
 * Database row types (snake_case to match PostgreSQL conventions)
 */

export interface RoomRow {
  id: string
  public_id: string
  secret_id: string
  name: string
  registration_open: boolean
  status: 'waiting' | 'drawing' | 'finished'
  current_prize_index: number
  settings: {
    gameType: string
    visualization: string
    theme: string
    prizeOrder: 'small-to-large' | 'large-to-small' | 'random'
  }
  created_at: string // ISO timestamp from Supabase
}

export interface PrizeRow {
  id: string
  room_id: string
  name: string
  description: string | null
  sort_order: number
  winner_id: string | null
  created_at: string // ISO timestamp from Supabase
}

export interface ParticipantRow {
  id: string
  room_id: string
  name: string
  has_won: boolean
  prize_id: string | null
  joined_at: string // ISO timestamp from Supabase
}

/**
 * Insert types (fields required when creating new rows)
 */

export interface RoomInsert {
  public_id: string
  name: string
  registration_open?: boolean
  status?: 'waiting' | 'drawing' | 'finished'
  current_prize_index?: number
  settings?: {
    gameType: string
    visualization: string
    theme: string
    prizeOrder: 'small-to-large' | 'large-to-small' | 'random'
  }
}

export interface PrizeInsert {
  room_id: string
  name: string
  description?: string
  sort_order: number
  winner_id?: string
}

export interface ParticipantInsert {
  room_id: string
  name: string
  has_won?: boolean
  prize_id?: string
}

/**
 * Update types (all fields optional)
 */

export interface RoomUpdate {
  name?: string
  registration_open?: boolean
  status?: 'waiting' | 'drawing' | 'finished'
  current_prize_index?: number
  settings?: {
    gameType?: string
    visualization?: string
    theme?: string
    prizeOrder?: 'small-to-large' | 'large-to-small' | 'random'
  }
}

export interface PrizeUpdate {
  name?: string
  description?: string
  sort_order?: number
  winner_id?: string
}

export interface ParticipantUpdate {
  name?: string
  has_won?: boolean
  prize_id?: string
}

/**
 * Helper type for the Database schema
 */
export interface Database {
  public: {
    Tables: {
      rooms: {
        Row: RoomRow
        Insert: RoomInsert
        Update: RoomUpdate
      }
      prizes: {
        Row: PrizeRow
        Insert: PrizeInsert
        Update: PrizeUpdate
      }
      participants: {
        Row: ParticipantRow
        Insert: ParticipantInsert
        Update: ParticipantUpdate
      }
    }
  }
}
