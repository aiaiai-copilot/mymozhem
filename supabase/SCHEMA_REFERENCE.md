# MyMozhem Database Schema Reference

Quick reference for the lottery system database schema.

## Entity Relationship Diagram

```
┌─────────────────┐
│     rooms       │
│─────────────────│
│ id (PK)         │◄──┐
│ public_id (UQ)  │   │
│ secret_id (UQ)  │   │
│ name            │   │
│ registration_   │   │
│   open          │   │
│ status          │   │
│ current_prize_  │   │
│   index         │   │
│ settings (JSON) │   │
│ created_at      │   │
└─────────────────┘   │
                      │
         ┌────────────┴─────────────┐
         │                          │
         │                          │
┌────────▼──────────┐      ┌────────▼──────────┐
│     prizes        │      │   participants    │
│───────────────────│      │───────────────────│
│ id (PK)           │      │ id (PK)           │
│ room_id (FK)      │      │ room_id (FK)      │
│ name              │      │ name              │
│ description       │      │ has_won           │
│ sort_order        │      │ prize_id (FK) ────┼──┐
│ winner_id (FK) ───┼──────┼──►id              │  │
│ created_at        │      │ joined_at         │  │
└───────────────────┘      └───────────────────┘  │
         ▲                                         │
         └─────────────────────────────────────────┘
```

## Tables

### rooms

Core table for lottery rooms.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Auto-generated UUID |
| public_id | VARCHAR(20) | UNIQUE NOT NULL | Short shareable ID (e.g., "NY2025-ABC") |
| secret_id | UUID | UNIQUE NOT NULL | Admin access UUID |
| name | VARCHAR(255) | NOT NULL | Room display name |
| registration_open | BOOLEAN | DEFAULT true | Can new participants join? |
| status | VARCHAR(20) | DEFAULT 'waiting' | Room state: 'waiting', 'drawing', 'finished' |
| current_prize_index | INTEGER | DEFAULT 0 | Current prize being drawn |
| settings | JSONB | DEFAULT '{}' | Plugin configuration |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Indexes:**
- `idx_rooms_public_id` on `public_id`
- `idx_rooms_secret_id` on `secret_id`
- `idx_rooms_status` on `status`

**Settings JSONB Structure:**
```json
{
  "gameType": "classic",
  "visualization": "name-reveal",
  "theme": "new-year",
  "prizeOrder": "small-to-large"
}
```

### prizes

Prizes for each room.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Auto-generated UUID |
| room_id | UUID | NOT NULL, FK -> rooms.id | Parent room |
| name | VARCHAR(255) | NOT NULL | Prize name |
| description | TEXT | NULL | Optional description |
| sort_order | INTEGER | NOT NULL | Drawing order (0-indexed) |
| winner_id | UUID | NULL, FK -> participants.id | Winner after drawing |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Indexes:**
- `idx_prizes_room_id` on `room_id`
- `idx_prizes_sort_order` on `(room_id, sort_order)`

**Foreign Keys:**
- `room_id` REFERENCES `rooms(id)` ON DELETE CASCADE
- `winner_id` REFERENCES `participants(id)`

### participants

Participants in each room.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Auto-generated UUID |
| room_id | UUID | NOT NULL, FK -> rooms.id | Parent room |
| name | VARCHAR(255) | NOT NULL | Display name |
| has_won | BOOLEAN | DEFAULT false | Excluded from future draws when true |
| prize_id | UUID | NULL, FK -> prizes.id | Won prize reference |
| joined_at | TIMESTAMPTZ | DEFAULT now() | Registration timestamp |

**Indexes:**
- `idx_participants_room_id` on `room_id`

**Constraints:**
- UNIQUE `(room_id, LOWER(name))` - Case-insensitive name uniqueness per room

**Foreign Keys:**
- `room_id` REFERENCES `rooms(id)` ON DELETE CASCADE
- `prize_id` REFERENCES `prizes(id)`

## Row Level Security (RLS)

All tables have RLS enabled with public access for the prototype.

### Current Policies (Prototype)

All tables have identical policy sets:
- `Public read [table]` - SELECT for all rows
- `Public insert [table]` - INSERT for all rows
- `Public update [table]` - UPDATE for all rows
- `Public delete [table]` - DELETE for all rows (rooms only)

### Future Policies (With Auth)

When authentication is added:

**rooms:**
- Owner can SELECT/UPDATE/DELETE their own rooms
- Public can SELECT rooms by public_id

**prizes:**
- Owner (via room.creator_id) can SELECT/INSERT/UPDATE/DELETE

**participants:**
- Anyone can INSERT (register)
- Public can SELECT participants in their room
- Owner can UPDATE/DELETE participants

## Realtime Configuration

All tables are added to `supabase_realtime` publication:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE prizes;
ALTER PUBLICATION supabase_realtime ADD TABLE participants;
```

**Expected Realtime Events:**

| Table | Event | Triggered When |
|-------|-------|----------------|
| rooms | UPDATE | Status change, registration toggle, prize index update |
| prizes | INSERT | New prize added |
| prizes | UPDATE | Winner assigned |
| participants | INSERT | New participant joins |
| participants | UPDATE | Participant wins prize |

## Common Queries

### Get room by public ID
```sql
SELECT * FROM rooms WHERE public_id = 'NY2025-ABC';
```

### Get room with all data
```sql
SELECT
  r.*,
  json_agg(DISTINCT p.*) AS prizes,
  json_agg(DISTINCT pt.*) AS participants
FROM rooms r
LEFT JOIN prizes p ON p.room_id = r.id
LEFT JOIN participants pt ON pt.room_id = r.id
WHERE r.public_id = 'NY2025-ABC'
GROUP BY r.id;
```

### Get next prize to draw
```sql
SELECT * FROM prizes
WHERE room_id = $1
  AND winner_id IS NULL
ORDER BY sort_order
LIMIT 1;
```

### Get eligible participants (not yet won)
```sql
SELECT * FROM participants
WHERE room_id = $1
  AND has_won = false
ORDER BY joined_at;
```

### Assign winner
```sql
-- Update participant
UPDATE participants
SET has_won = true, prize_id = $1
WHERE id = $2;

-- Update prize
UPDATE prizes
SET winner_id = $2
WHERE id = $1;
```

## Type Mappings

### Database (snake_case) → Application (camelCase)

Use the mappers in `src/lib/mappers.ts`:

```typescript
import { mapRoomFromDb, mapPrizeFromDb, mapParticipantFromDb } from '@/lib/mappers'

const room = mapRoomFromDb(dbRow)
const prize = mapPrizeFromDb(dbRow)
const participant = mapParticipantFromDb(dbRow)
```

### TypeScript Types

**Database types:** `src/types/database.ts` (snake_case, exact DB mapping)
**Application types:** `src/types/index.ts` (camelCase, app-level)

## Migration History

| File | Date | Description |
|------|------|-------------|
| `20251222000000_initial_schema.sql` | 2025-12-22 | Initial schema with rooms, prizes, participants |
