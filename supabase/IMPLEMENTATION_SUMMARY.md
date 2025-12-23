# Database Schema Implementation Summary

Complete Supabase database schema for MyMozhem lottery system, created on 2025-12-22.

## Files Created

### Migration Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20251222000000_initial_schema.sql` | Complete database schema migration |
| `supabase/migrations/README.md` | Migration documentation and workflow guide |
| `supabase/validate-schema.sql` | Validation queries to verify setup |
| `supabase/SCHEMA_REFERENCE.md` | Quick reference guide with ERD and examples |
| `supabase/IMPLEMENTATION_SUMMARY.md` | This file |

### TypeScript Type Files

| File | Purpose |
|------|---------|
| `src/types/database.ts` | Database row types (snake_case, exact DB mapping) |
| `src/types/index.ts` | Application types (camelCase, updated to align with DB) |
| `src/lib/mappers.ts` | Transform functions between DB and app types |

## Database Schema

### Tables Created

1. **rooms** - Core lottery rooms
   - 9 columns: id, public_id, secret_id, name, registration_open, status, current_prize_index, settings, created_at
   - 3 indexes: public_id, secret_id, status
   - Unique constraints: public_id, secret_id

2. **prizes** - Prizes for each room
   - 7 columns: id, room_id, name, description, sort_order, winner_id, created_at
   - 2 indexes: room_id, (room_id, sort_order)
   - Foreign keys: room_id -> rooms.id (CASCADE), winner_id -> participants.id

3. **participants** - Participants in rooms
   - 6 columns: id, room_id, name, has_won, prize_id, joined_at
   - 1 index: room_id
   - Unique constraint: (room_id, LOWER(name))
   - Foreign keys: room_id -> rooms.id (CASCADE), prize_id -> prizes.id

### Features Enabled

- **Row Level Security (RLS):** Enabled on all tables with permissive policies for prototype
- **Realtime Subscriptions:** All tables added to `supabase_realtime` publication
- **Cascading Deletes:** Room deletion automatically removes prizes and participants
- **Case-Insensitive Names:** Participants can't register duplicate names (case-insensitive)

## How to Apply Migration

### Option 1: Supabase CLI (Recommended for Production)

```bash
# Link to your project
supabase link --project-ref your-project-ref

# Apply migration
supabase db push

# Verify
psql $DATABASE_URL -f supabase/validate-schema.sql
```

### Option 2: Supabase MCP (Quick Development)

```bash
# 1. Authenticate
/mcp

# 2. Copy and execute SQL from:
# supabase/migrations/20251222000000_initial_schema.sql

# 3. Verify
# Ask: "list all tables in public schema"
```

### Option 3: Supabase Dashboard (Manual)

1. Open Supabase Dashboard
2. Navigate to SQL Editor
3. Copy entire contents of `supabase/migrations/20251222000000_initial_schema.sql`
4. Execute
5. Check Table Editor to verify tables appear

## Validation

After applying the migration, run validation queries:

```bash
# Using psql
psql $DATABASE_URL -f supabase/validate-schema.sql

# Expected results:
# - 3 tables (rooms, prizes, participants)
# - Multiple indexes on key columns
# - Foreign key constraints with CASCADE
# - RLS enabled on all tables
# - All tables in supabase_realtime publication
```

## Next Steps

### 1. Repository Implementation

Create `src/repositories/supabase.lottery.repository.ts`:

```typescript
import { supabase } from '@/lib/supabase'
import { mapRoomFromDb, mapPrizeFromDb, mapParticipantFromDb } from '@/lib/mappers'

export class SupabaseLotteryRepository {
  async createRoom(data: CreateRoomData) {
    const publicId = generatePublicId() // Implement ID generator
    const insert = mapRoomToDb(data, publicId)

    const { data: row, error } = await supabase
      .from('rooms')
      .insert(insert)
      .select()
      .single()

    if (error) throw error
    return mapRoomFromDb(row)
  }

  // ... more methods
}
```

### 2. Realtime Hooks

Use patterns from `supabase-realtime` skill:

```typescript
import { useRoomRealtime } from '@/hooks/useRoomRealtime'

function ParticipantView({ roomId }: { roomId: string }) {
  const { room, participants, prizes, isLoading } = useRoomRealtime(roomId)

  // Component automatically updates in realtime
}
```

### 3. Public ID Generation

Implement short ID generator for rooms:

```typescript
// Example: "NY2025-A7K3"
function generatePublicId(): string {
  const prefix = 'NY2025'
  const suffix = generateRandomString(4)
  return `${prefix}-${suffix}`
}
```

## Architecture Alignment

This schema implements the following PRD requirements:

- **FR-01:** Room creation with unique public/secret IDs
- **FR-02:** Prize management with ordering
- **FR-04:** Participant registration with name validation
- **FR-05:** Realtime participant list via Supabase Realtime
- **FR-07:** Drawing logic with winner exclusion (has_won flag)
- **FR-10:** Room deletion with cascade

### Plugin Support

Settings JSONB field stores plugin configuration:

```json
{
  "gameType": "classic",
  "visualization": "name-reveal",
  "theme": "new-year",
  "prizeOrder": "small-to-large"
}
```

Ready for future game types, visualizations, and themes as per plugin architecture.

## Security Notes

### Current Setup (Prototype)

- Public access to all tables
- No authentication required
- Suitable for MVP/demo

### Production Readiness

When adding authentication:

1. Add `creator_id UUID REFERENCES auth.users(id)` to rooms table
2. Replace public policies with owner-based policies (templates in migration file)
3. Add RLS policies for participant read access
4. Consider rate limiting for participant registration

See commented templates in `20251222000000_initial_schema.sql` for production policy examples.

## Performance Considerations

- **Indexes created:** public_id, secret_id, room_id lookups are fast
- **Expected load:** 100-500 concurrent users per room (typical event size)
- **Realtime scaling:** Supabase Realtime handles this automatically
- **Query optimization:** Use room_id filters in all participant/prize queries

## Troubleshooting

### Migration fails with "publication does not exist"

Ensure Supabase Realtime is enabled on your project:
- Check Supabase Dashboard -> Database -> Replication
- `supabase_realtime` publication should exist

### Unique constraint violations on participant names

Working as intended - names are case-insensitive unique per room:
- "Alice" and "alice" cannot both exist in same room
- Different rooms can have participants with same name

### Cascade delete not working

Verify foreign key constraints:
```sql
SELECT * FROM pg_constraint WHERE contype = 'f';
```

Should show ON DELETE CASCADE for room_id columns.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-22 | Initial schema with rooms, prizes, participants |

---

**Schema ready for prototype v0.1 implementation!**
