# Database Migrations

This directory contains SQL migration files for the MyMozhem Supabase database.

## Migration Files

- `20251222000000_initial_schema.sql` - Initial schema with rooms, prizes, and participants tables

## Schema Overview

### Tables

**rooms**
- Primary table for lottery rooms
- Contains public_id (short shareable ID) and secret_id (admin access UUID)
- Status flow: waiting -> drawing -> finished
- Settings stored as JSONB for plugin configuration

**prizes**
- Prizes linked to rooms via room_id
- Ordered by sort_order for drawing sequence
- winner_id references participants after drawing

**participants**
- Participants linked to rooms
- Unique constraint on (room_id, LOWER(name)) for case-insensitive uniqueness
- has_won flag excludes from future draws
- prize_id references won prize

### Realtime Configuration

All three tables are added to `supabase_realtime` publication for live synchronization:
- Room status updates broadcast to all participants
- New participants appear in realtime
- Winner assignments update immediately

### Row Level Security (RLS)

Prototype uses permissive policies (public access). Production templates are commented in the migration file.

## Applying Migrations

### Using Supabase CLI

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Apply migrations
supabase db push
```

### Using Supabase MCP (Development)

```bash
# 1. Authenticate MCP
/mcp

# 2. List tables to verify
# Ask: "list all tables in public schema"

# 3. Run migration file
# Copy SQL from migration file and execute via MCP
```

### Manual Application (Supabase Dashboard)

1. Open Supabase Dashboard -> SQL Editor
2. Copy contents of `20251222000000_initial_schema.sql`
3. Execute the SQL
4. Verify tables appear in Table Editor

## Development Workflow

### Quick Iterations (Development)
Use Supabase MCP for rapid prototyping:
- Run queries directly without creating migration files
- Test schema changes interactively
- Verify RLS policies

### Production Changes
Create proper migration files:
1. Create new file: `YYYYMMDDHHMMSS_description.sql`
2. Write SQL with clear comments
3. Test migration on development database
4. Commit to version control
5. Apply to production via Supabase CLI

## Indexes

Performance indexes are included for:
- `rooms.public_id` and `rooms.secret_id` (URL lookups)
- `prizes.room_id` and `prizes.sort_order` (room-scoped queries)
- `participants.room_id` (room-scoped queries)

## Future Migrations

When adding authentication:
1. Add `creator_id UUID REFERENCES auth.users(id)` to rooms table
2. Replace public policies with owner-based policies
3. See commented templates in initial schema file
