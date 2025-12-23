-- Schema Validation Queries
-- Run these after applying migrations to verify correct setup

-- =============================================================================
-- 1. Verify all tables exist
-- =============================================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('rooms', 'prizes', 'participants')
ORDER BY table_name;
-- Expected: 3 rows (participants, prizes, rooms)

-- =============================================================================
-- 2. Verify all columns exist with correct types
-- =============================================================================

-- Rooms table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rooms'
ORDER BY ordinal_position;
-- Expected: 9 columns (id, public_id, secret_id, name, registration_open, status, current_prize_index, settings, created_at)

-- Prizes table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'prizes'
ORDER BY ordinal_position;
-- Expected: 7 columns (id, room_id, name, description, sort_order, winner_id, created_at)

-- Participants table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'participants'
ORDER BY ordinal_position;
-- Expected: 6 columns (id, room_id, name, has_won, prize_id, joined_at)

-- =============================================================================
-- 3. Verify indexes
-- =============================================================================

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('rooms', 'prizes', 'participants')
ORDER BY tablename, indexname;
-- Expected: Multiple indexes including idx_rooms_public_id, idx_rooms_secret_id, etc.

-- =============================================================================
-- 4. Verify foreign key constraints
-- =============================================================================

SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('prizes', 'participants')
ORDER BY tc.table_name, kcu.column_name;
-- Expected:
-- prizes.room_id -> rooms.id (CASCADE)
-- prizes.winner_id -> participants.id
-- participants.room_id -> rooms.id (CASCADE)
-- participants.prize_id -> prizes.id

-- =============================================================================
-- 5. Verify unique constraints
-- =============================================================================

SELECT
  tc.table_name,
  kcu.column_name,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'UNIQUE'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('rooms', 'prizes', 'participants')
ORDER BY tc.table_name, kcu.column_name;
-- Expected:
-- rooms.public_id
-- rooms.secret_id
-- participants.(room_id, LOWER(name))

-- =============================================================================
-- 6. Verify RLS is enabled
-- =============================================================================

SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('rooms', 'prizes', 'participants');
-- Expected: All tables have rowsecurity = true

-- =============================================================================
-- 7. Verify RLS policies
-- =============================================================================

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('rooms', 'prizes', 'participants')
ORDER BY tablename, policyname;
-- Expected: 4 policies per table (read, insert, update, delete for rooms; read, insert, update for others)

-- =============================================================================
-- 8. Verify realtime publication
-- =============================================================================

SELECT
  p.pubname,
  pt.schemaname,
  pt.tablename
FROM pg_publication p
JOIN pg_publication_tables pt ON p.pubname = pt.pubname
WHERE p.pubname = 'supabase_realtime'
  AND pt.schemaname = 'public'
  AND pt.tablename IN ('rooms', 'prizes', 'participants')
ORDER BY pt.tablename;
-- Expected: 3 rows (all tables in supabase_realtime publication)

-- =============================================================================
-- 9. Test basic operations
-- =============================================================================

-- Insert test room
INSERT INTO rooms (public_id, name, settings)
VALUES (
  'TEST-001',
  'Test Room',
  '{"gameType": "classic", "visualization": "name-reveal", "theme": "new-year", "prizeOrder": "small-to-large"}'::jsonb
)
RETURNING *;

-- Insert test prize (using room_id from above)
INSERT INTO prizes (room_id, name, sort_order)
SELECT id, 'Test Prize', 0
FROM rooms
WHERE public_id = 'TEST-001'
RETURNING *;

-- Insert test participant (using room_id from above)
INSERT INTO participants (room_id, name)
SELECT id, 'Test Participant'
FROM rooms
WHERE public_id = 'TEST-001'
RETURNING *;

-- Verify case-insensitive name uniqueness
INSERT INTO participants (room_id, name)
SELECT id, 'test participant'  -- lowercase version
FROM rooms
WHERE public_id = 'TEST-001'
RETURNING *;
-- Expected: ERROR - violates unique constraint

-- Clean up test data
DELETE FROM rooms WHERE public_id = 'TEST-001';
-- Expected: Cascades to prizes and participants

-- =============================================================================
-- 10. Verify cleanup worked
-- =============================================================================

SELECT COUNT(*) FROM rooms WHERE public_id = 'TEST-001';
SELECT COUNT(*) FROM prizes WHERE room_id IN (SELECT id FROM rooms WHERE public_id = 'TEST-001');
SELECT COUNT(*) FROM participants WHERE room_id IN (SELECT id FROM rooms WHERE public_id = 'TEST-001');
-- Expected: All return 0
