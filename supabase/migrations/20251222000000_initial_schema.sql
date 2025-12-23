-- MyMozhem Lottery System - Initial Schema
-- Migration: 20251222000000_initial_schema.sql
-- Description: Creates rooms, prizes, and participants tables with RLS and realtime support

-- =============================================================================
-- TABLES
-- =============================================================================

-- Rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(20) UNIQUE NOT NULL,
  secret_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  registration_open BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'waiting',
  current_prize_index INTEGER DEFAULT 0,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prizes table
CREATE TABLE prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL,
  winner_id UUID REFERENCES participants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Participants table
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  has_won BOOLEAN DEFAULT false,
  prize_id UUID REFERENCES prizes(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, LOWER(name))
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Fast lookups by public_id and secret_id (used in URLs)
CREATE INDEX idx_rooms_public_id ON rooms(public_id);
CREATE INDEX idx_rooms_secret_id ON rooms(secret_id);
CREATE INDEX idx_rooms_status ON rooms(status);

-- Fast room-scoped queries
CREATE INDEX idx_prizes_room_id ON prizes(room_id);
CREATE INDEX idx_prizes_sort_order ON prizes(room_id, sort_order);
CREATE INDEX idx_participants_room_id ON participants(room_id);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

-- Rooms policies (public access for prototype)
CREATE POLICY "Public read rooms"
  ON rooms FOR SELECT
  USING (true);

CREATE POLICY "Public insert rooms"
  ON rooms FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update rooms"
  ON rooms FOR UPDATE
  USING (true);

CREATE POLICY "Public delete rooms"
  ON rooms FOR DELETE
  USING (true);

-- Prizes policies (public access for prototype)
CREATE POLICY "Public read prizes"
  ON prizes FOR SELECT
  USING (true);

CREATE POLICY "Public insert prizes"
  ON prizes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update prizes"
  ON prizes FOR UPDATE
  USING (true);

CREATE POLICY "Public delete prizes"
  ON prizes FOR DELETE
  USING (true);

-- Participants policies (public access for prototype)
CREATE POLICY "Public read participants"
  ON participants FOR SELECT
  USING (true);

CREATE POLICY "Public insert participants"
  ON participants FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update participants"
  ON participants FOR UPDATE
  USING (true);

CREATE POLICY "Public delete participants"
  ON participants FOR DELETE
  USING (true);

-- =============================================================================
-- REALTIME SUBSCRIPTIONS
-- =============================================================================

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE prizes;
ALTER PUBLICATION supabase_realtime ADD TABLE participants;

-- =============================================================================
-- FUTURE AUTH TEMPLATES (commented for reference)
-- =============================================================================

-- When authentication is added, replace public policies with:
--
-- CREATE POLICY "Owner access rooms"
--   ON rooms FOR ALL
--   USING (auth.uid() = creator_id);
--
-- CREATE POLICY "Public read via public_id"
--   ON rooms FOR SELECT
--   USING (public_id IS NOT NULL);
--
-- CREATE POLICY "Owner access prizes"
--   ON prizes FOR ALL
--   USING (
--     EXISTS (
--       SELECT 1 FROM rooms
--       WHERE rooms.id = prizes.room_id
--       AND rooms.creator_id = auth.uid()
--     )
--   );
