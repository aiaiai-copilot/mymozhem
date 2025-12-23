# MyMozhem Lottery v0.1 - Implementation Plan

## Session Handoff Summary

**Project:** MyMozhem - Interactive entertainment platform for events
**Current Module:** Lottery (first game, prototype v0.1)
**Repository:** https://github.com/aiaiai-copilot/mymozhem
**Status:** Phase 0 & 1 complete, ready for Phase 2 (React hooks)
**Branch:** master (1 commit ahead, just pushed)
**Latest Commit:** `53b647f` - Implement Phase 0 and Phase 1: Database schema and repository layer

### What's Done

**Foundation (Phases 0-1 Complete):**
- ✅ Project scaffolding (Vite + React + TypeScript + Supabase)
- ✅ Git repository initialized and pushed to GitHub
- ✅ Complete type system (Room, Prize, Participant, plugins)
- ✅ Repository pattern fully implemented
- ✅ Plugin architecture designed (games, visualizations, themes)
- ✅ i18n system with complete Russian translations
- ✅ Project rebranded as multi-game platform
- ✅ PRD documentation complete
- ✅ Specialized agents configured

**Phase 0 - Database & Schema:**
- ✅ Fixed 29 TypeScript build errors
- ✅ Supabase project created ("mymozhem", us-west-2)
- ✅ Database migration applied successfully
- ✅ Tables: rooms, prizes, participants (with RLS + Realtime)
- ✅ Case-insensitive unique name constraint working
- ✅ Cascade delete verified
- ✅ Database type definitions (`src/types/database.ts`)
- ✅ Type mappers (`src/lib/mappers.ts`)

**Phase 1 - Repository Implementation:**
- ✅ All CRUD methods implemented
- ✅ Public ID generation (NY2025-XXX format)
- ✅ Realtime subscriptions (rooms, prizes, participants)
- ✅ Auto-incrementing prize sort_order
- ✅ Validation test script (15/15 tests passing)
- ✅ Supabase client supports Vite + Node.js

### Current Status

**What Works:**
- ✅ TypeScript builds with 0 errors
- ✅ Complete data layer (repository + database)
- ✅ All repository methods tested and validated
- ✅ Realtime synchronization functional
- ✅ Environment variables configured (.env)

**What's Missing:**
- ❌ No React hooks for data management
- ❌ No UI components
- ❌ No pages (Landing, AdminDashboard, ParticipantRoom)
- ❌ No drawing logic implementation
- ❌ No theme integration

### Immediate Next Steps (Phase 2)

**Priority:** Create React hooks to connect repository to UI

1. **Data Hooks** (30-45 min each):
   - `useRoom.ts` - Fetch + subscribe to room by ID
   - `useRoomByPublicId.ts` - For participant view
   - `useRoomBySecretId.ts` - For admin dashboard
   - `usePrizes.ts` - Real-time prize list
   - `useParticipants.ts` - Real-time participant list

2. **Action Hooks** (20-30 min each):
   - `useRoomActions.ts` - createRoom, updateRoom, deleteRoom
   - `usePrizeActions.ts` - addPrize, updatePrize, deletePrize
   - `useParticipantActions.ts` - addParticipant

3. **Validation:**
   - Create test component to verify hooks work
   - Test real-time updates in browser

### Key Files to Know

**Core Implementation:**
- `src/repositories/supabase.lottery.repository.ts` - Complete repository (316 lines)
- `src/lib/mappers.ts` - snake_case ↔ camelCase conversion
- `src/types/database.ts` - Database schema types
- `src/types/index.ts` - Application types
- `supabase/migrations/20251222000000_initial_schema.sql` - Database schema

**Configuration:**
- `.env` - Supabase credentials (gitignored)
- `tsconfig.json` - Excludes `src/scripts/` from build
- `supabase/IMPLEMENTATION_SUMMARY.md` - Schema documentation

**Testing:**
- `src/scripts/test-repository.ts` - Phase 1 validation (all passing)
- Run: `npx tsx src/scripts/test-repository.ts`

**Documentation:**
- `docs/PRD.md` - Product requirements (source of truth)
- `CLAUDE.md` - Development guidelines and agent usage
- `src/i18n/ru.ts` - All UI strings (Russian only for v0.1)

### Architecture Principles

1. Plugin-based extensibility (games, visualizations, themes)
2. Repository pattern for data access abstraction
3. All UI strings through i18n (no hardcoded text)
4. Mobile-first responsive design
5. Real-time synchronization via Supabase Realtime

### Environment

**Supabase Project:**
- Name: `mymozhem`
- Region: `us-west-2`
- Status: ACTIVE_HEALTHY
- Tables: rooms, prizes, participants (with RLS + Realtime enabled)

**Dependencies:**
- React, TypeScript, Vite
- Supabase client, Realtime
- shadcn/ui, Tailwind CSS
- framer-motion, qrcode.react
- react-router-dom
- Vitest, Testing Library
- dotenv (for Node.js scripts)

---

## Overview

Complete the lottery prototype with full end-to-end functionality: room creation, prize management, participant registration, real-time synchronization, and drawing with animations.

---

## Phase 0: Foundation ✅ COMPLETE

### ✅ Fix TypeScript Build Errors
**Status:** DONE (commit 53b647f)
- Fixed 28 unused parameters in `supabase.lottery.repository.ts`
- Fixed 1 unused parameter in `classic.ts`
- Build passes with 0 errors

### ✅ Database Schema Setup
**Status:** DONE (commit 53b647f)
**Agent:** `supabase-schema`

**Tables created:**
```sql
rooms (
  id UUID PRIMARY KEY,
  public_id VARCHAR(20) UNIQUE,
  secret_id UUID UNIQUE,
  name VARCHAR(255),
  registration_open BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'waiting',
  current_prize_index INTEGER DEFAULT 0,
  settings JSONB,
  created_at TIMESTAMPTZ
)

prizes (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES rooms ON DELETE CASCADE,
  name VARCHAR(255),
  description TEXT,
  sort_order INTEGER,
  winner_id UUID REFERENCES participants,
  created_at TIMESTAMPTZ
)

participants (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES rooms ON DELETE CASCADE,
  name VARCHAR(255),
  has_won BOOLEAN DEFAULT false,
  prize_id UUID REFERENCES prizes,
  joined_at TIMESTAMPTZ
)
```

**Note:** Case-insensitive unique constraint implemented via index:
```sql
CREATE UNIQUE INDEX idx_participants_unique_name
ON participants(room_id, LOWER(name));
```

**Enabled:**
- ✅ RLS policies (public access for prototype)
- ✅ Realtime on all tables
- ✅ Indexes on public_id, secret_id

---

## Phase 1: Repository Implementation ✅ COMPLETE

### ✅ Implement All CRUD Methods
**Status:** DONE (commit 53b647f)
**File:** `src/repositories/supabase.lottery.repository.ts`

**Implemented methods:**
1. ✅ `createRoom()` - Generates publicId format "NY2025-XXX", secretId UUID
2. ✅ `getRoom()`, `getRoomByPublicId()`, `getRoomBySecretId()`
3. ✅ `updateRoom()` - Status changes, registration toggle
4. ✅ `addPrize()`, `getPrizes()`, `updatePrize()`, `deletePrize()`
5. ✅ `addParticipant()` - Enforces case-insensitive name uniqueness
6. ✅ `getParticipants()`, `updateParticipant()`
7. ✅ `deleteRoom()` - Cascade handled by DB

**Features:**
- snake_case ↔ camelCase mapping via mappers
- Auto-incrementing prize sort_order
- Custom error messages for unique constraint violations
- Proper cleanup functions for subscriptions

### ✅ Implement Realtime Subscriptions
**Status:** DONE (commit 53b647f)
**Consulted:** `supabase-realtime` skill

**Methods:**
- ✅ `subscribeToRoom(roomId, callback)` - Room status updates
- ✅ `subscribeToPrizes(roomId, callback)` - Prize changes
- ✅ `subscribeToParticipants(roomId, callback)` - Participant joins/wins

**Pattern used:**
```typescript
const channel = supabase
  .channel(`room:${roomId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'rooms',
    filter: `id=eq.${roomId}`
  }, payload => callback(mapRoomFromDb(payload.new)))
  .subscribe()

return () => { channel.unsubscribe() }
```

---

## Phase 2: React Hooks ⬅️ START HERE

### Data Hooks (Create in `src/hooks/`)

**1. useRoom.ts**
```typescript
export function useRoom(roomId: string | undefined) {
  const [room, setRoom] = useState<Room | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!roomId) return

    setLoading(true)
    lotteryRepository.getRoom(roomId)
      .then(setRoom)
      .catch(setError)
      .finally(() => setLoading(false))

    const unsub = lotteryRepository.subscribeToRoom(roomId, setRoom)
    return unsub
  }, [roomId])

  return { room, loading, error }
}
```

**2. useRoomByPublicId.ts** - Same pattern, use `getRoomByPublicId()`

**3. useRoomBySecretId.ts** - Same pattern, use `getRoomBySecretId()`

**4. usePrizes.ts**
```typescript
export function usePrizes(roomId: string | undefined) {
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!roomId) return

    setLoading(true)
    lotteryRepository.getPrizes(roomId)
      .then(setPrizes)
      .catch(setError)
      .finally(() => setLoading(false))

    const unsub = lotteryRepository.subscribeToPrizes(roomId, setPrizes)
    return unsub
  }, [roomId])

  return { prizes, loading, error }
}
```

**5. useParticipants.ts** - Same pattern for participants

### Action Hooks

**1. useRoomActions.ts**
```typescript
export function useRoomActions() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createRoom = useCallback(async (data: CreateRoomData) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.createRoom(data)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const updateRoom = useCallback(async (id: string, data: Partial<Room>) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.updateRoom(id, data)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteRoom = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      await lotteryRepository.deleteRoom(id)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { createRoom, updateRoom, deleteRoom, loading, error }
}
```

**2. usePrizeActions.ts** - Similar pattern for prizes

**3. useParticipantActions.ts** - Similar pattern for participants

### Validation (Phase 2)

Create test component to verify hooks:

**`src/components/test/HookTest.tsx`:**
```typescript
export function HookTest() {
  const { room } = useRoomByPublicId('NY2025-001')
  const { prizes } = usePrizes(room?.id)
  const { participants } = useParticipants(room?.id)
  const { createRoom } = useRoomActions()

  return (
    <div>
      <p>Room: {room?.name || 'Loading...'}</p>
      <p>Prizes: {prizes?.length || 0}</p>
      <p>Participants: {participants?.length || 0}</p>
      <button onClick={() => createRoom({ name: 'Test' })}>
        Create Room
      </button>
    </div>
  )
}
```

**Validation checklist:**
- ✓ Hooks load data correctly
- ✓ Real-time updates reflect in UI
- ✓ Loading states work
- ✓ Error handling works
- ✓ No console errors

---

## Phase 3: UI Components

### Install shadcn/ui Components
**Agent:** `component-creator`

Run: `npx shadcn@latest add button input card dialog label badge separator skeleton toast`

### Lottery Components (`src/components/lottery/`)
**Agent:** `component-creator`
**Consult:** `react-components` skill

1. **RoomCreationForm** - Name input, submit handler
2. **RoomInfoCard** - Public link, QR code, copy button
3. **PrizeList** - Display prizes with winners
4. **PrizeForm** - Add/edit dialog
5. **ParticipantList** - Real-time list with count
6. **ParticipantRegistration** - Name form with validation
7. **DrawingControls** - Start button, validation
8. **WinnerDisplay** - Animation container

### Admin Components (`src/components/admin/`)
1. **DashboardLayout** - Header, sections
2. **PrizeManagement** - Combines list + form
3. **ParticipantManagement** - List + registration toggle
4. **DrawingPanel** - Controls + status

---

## Phase 4: Pages

### Landing Page (`src/pages/Landing.tsx`)
**Agent:** `component-creator`

- RoomCreationForm in dialog
- On success → navigate to `/admin/:secretId`
- New Year theme applied

### Admin Dashboard (`src/pages/AdminDashboard.tsx`)
**Agent:** `component-creator`

```typescript
export function AdminDashboard() {
  const { secretId } = useParams()
  const { room } = useRoomBySecretId(secretId)
  const { prizes } = usePrizes(room?.id)
  const { participants } = useParticipants(room?.id)

  return (
    <DashboardLayout>
      <RoomInfoCard room={room} />
      <PrizeManagement roomId={room?.id} prizes={prizes} />
      <ParticipantManagement roomId={room?.id} participants={participants} />
      <DrawingPanel room={room} prizes={prizes} participants={participants} />
    </DashboardLayout>
  )
}
```

### Participant Room (`src/pages/ParticipantRoom.tsx`)
**Agent:** `component-creator`

**State machine:**
- `waiting + registrationOpen` → ParticipantRegistration
- `waiting + registrationClosed` → Waiting screen
- `drawing` → WinnerDisplay
- `finished` → Results

---

## Phase 5: Drawing Logic

### Create Drawing Hook (`src/hooks/useDrawing.ts`)

**Flow:**
1. Start: Set room.status = 'drawing'
2. For each prize (by sort_order):
   - Call `classicGame.selectWinners()` for 1 prize
   - Update participant: hasWon = true, prizeId
   - Update prize: winnerId
   - Increment room.currentPrizeIndex
   - Trigger visualization
   - Wait 3-5 seconds
3. End: Set room.status = 'finished'

### Register Plugins

**Files:**
- `src/plugins/games/index.ts`
- `src/plugins/visualizations/index.ts`
- `src/plugins/themes/index.ts`

**Action:** Uncomment imports and registration calls

### Enhance Visualization (`src/plugins/visualizations/name-reveal.ts`)
**Agent:** `component-creator`

- Use framer-motion for animations
- Add confetti effect
- Coordinate timing across devices

---

## Phase 6: Theme & Polish

### New Year Theme
**Agent:** `theme-designer`

- Enhance `src/plugins/themes/new-year.ts` with full CSS variables
- Add snowflake SVG animations to `src/index.css`
- Gold accents, blue gradients
- Festive typography

### QR Code (`src/components/lottery/RoomInfoCard.tsx`)

```typescript
import { QRCodeSVG } from 'qrcode.react'

<QRCodeSVG
  value={`${window.location.origin}/room/${room.publicId}`}
  size={200}
/>
```

### Error Handling
- Add Skeleton loaders to all components
- Error boundaries for runtime errors
- User-friendly i18n error messages
- Toast notifications for actions

### Mobile Responsiveness
- Test all pages at 375px width
- Single-column layout on mobile
- Touch-friendly buttons (44x44px min)
- Responsive QR code sizing

---

## Phase 7: Testing & Deployment

### Testing
**Agent:** `test-writer`

**Scenarios:**
1. Happy path: Create → Add prizes → Join → Draw → Results
2. Duplicate names (should fail)
3. Registration closed (can't join)
4. Insufficient participants/prizes (can't start)

### Supabase Production
**Agent:** `supabase-schema`

- Create production project
- Run migrations
- Verify Realtime enabled
- Update env vars

### Vercel Deployment
- Connect GitHub repo
- Set env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
- Deploy and test

---

## Validation Strategy

**Approach:** Phase-by-phase validation with clear checkpoints to catch errors early and build incremental confidence.

### Phase 0 Validation ✅ COMPLETE
```bash
pnpm build  # Must pass with 0 errors
```
- ✅ TypeScript compiles successfully
- ✅ Supabase tables exist (verified via MCP)
- ✅ RLS policies enabled on all tables
- ✅ Realtime enabled on rooms, prizes, participants
- ✅ Indexes created on public_id, secret_id

### Phase 1 Validation ✅ COMPLETE
**Test script:** `src/scripts/test-repository.ts`

**Run:** `npx tsx src/scripts/test-repository.ts`

**Results:**
- ✅ All CRUD operations work
- ✅ Case-insensitive name uniqueness enforced
- ✅ Realtime subscriptions fire on updates
- ✅ Snake_case ↔ camelCase mapping correct
- ✅ No TypeScript errors
- ✅ 15/15 tests passing

### Phase 2 Validation ⬅️ NEXT
**Create test component:** `src/components/test/HookTest.tsx`

**Add to App.tsx temporarily, run `pnpm dev`**

**Checklist:**
- ✓ Hooks load data correctly
- ✓ Real-time updates reflect in UI (update DB via Supabase dashboard)
- ✓ Loading states work
- ✓ No console errors

### Phase 3-4 Validation
```bash
pnpm dev  # Start dev server
```

**Manual browser testing:**
1. Navigate to `/` (Landing)
   - ✓ Room creation form visible
   - ✓ Submit creates room
   - ✓ Redirects to `/admin/:secretId`

2. Admin Dashboard (`/admin/:secretId`)
   - ✓ Room info displays (public link, QR code)
   - ✓ Add prize form works
   - ✓ Prize list updates in real-time
   - ✓ Participant registration toggle works
   - ✓ Participant list shows count

3. Participant Room (`/room/:publicId`)
   - ✓ Registration form appears when open
   - ✓ Submit adds participant
   - ✓ Name appears in list immediately
   - ✓ Waiting screen shows when registration closed

**Checklist:**
- ✓ All components render without errors
- ✓ Forms submit successfully
- ✓ Navigation works
- ✓ No TypeScript/ESLint warnings

### Phase 5 Validation (CRITICAL)
**Multi-device testing:**

1. Open 2 browser windows:
   - Window A: `/admin/:secretId` (organizer)
   - Window B: `/room/:publicId` (participant)

2. Execute full lottery flow:
   - ✓ Admin adds 3 prizes
   - ✓ Participant joins (sees name in list)
   - ✓ Admin closes registration
   - ✓ Participant sees "waiting" screen
   - ✓ Admin clicks "Start Drawing"
   - ✓ **Both windows** show drawing animation
   - ✓ Winner revealed simultaneously on both screens
   - ✓ Process repeats for all 3 prizes
   - ✓ Room status changes to "finished"
   - ✓ Results screen shows all winners

**Checklist:**
- ✓ Drawing logic executes sequentially
- ✓ Animations sync across devices
- ✓ Winner selection uses classicGame plugin
- ✓ Database updates correctly (hasWon, prizeId, winnerId)
- ✓ No participant wins twice
- ✓ No race conditions

### Phase 6 Validation
**Visual QA:**
```bash
pnpm dev
# Open DevTools → Toggle device toolbar → iPhone 12 Pro (390x844)
```

**Mobile testing checklist:**
- ✓ All pages work at 375px width
- ✓ QR code displays and scales correctly
- ✓ Buttons are touch-friendly (min 44x44px)
- ✓ Forms usable on mobile keyboard
- ✓ New Year theme applied (snowflakes, gold accents)
- ✓ Animations perform smoothly

**Error handling:**
- ✓ Skeleton loaders show while data loading
- ✓ Error messages display in Russian (i18n)
- ✓ Network errors handled gracefully

### Phase 7 Validation
**Automated tests:**
```bash
pnpm test  # Run full test suite
```

**E2E scenarios:**
1. ✓ Happy path (create → add → join → draw → results)
2. ✓ Duplicate name rejection
3. ✓ Registration closed prevents join
4. ✓ Insufficient participants/prizes prevents start

**Production deployment:**
```bash
# Supabase production project
# - Tables created via migrations
# - Realtime enabled
# - RLS policies active

# Vercel deployment
# - Environment variables set
# - Build succeeds
# - Deployed URL accessible
```

**Smoke test on production:**
- ✓ Create room works
- ✓ Add prize works
- ✓ Participant can join
- ✓ Drawing completes
- ✓ HTTPS certificate valid
- ✓ Mobile browsers work (iOS Safari, Android Chrome)

---

## Critical Files

1. `src/repositories/supabase.lottery.repository.ts` - Core data layer (COMPLETE)
2. `src/hooks/useRoom.ts` - Primary room state management (TODO)
3. `src/pages/AdminDashboard.tsx` - Organizer interface (TODO)
4. `src/pages/ParticipantRoom.tsx` - Participant interface (TODO)
5. `src/hooks/useDrawing.ts` - Drawing orchestration (TODO)

---

## Success Criteria

- ✅ TypeScript builds without errors
- ✅ All repository methods implemented
- ⬜ Real-time updates work across devices
- ⬜ Complete lottery flow works end-to-end
- ⬜ Drawing syncs with animation
- ⬜ New Year theme applied
- ⬜ Works on mobile (iOS Safari, Android Chrome)
- ⬜ Deployed to Vercel

---

## Execution Order

1. ✅ Phase 0 (CRITICAL BLOCKER) - COMPLETE
2. ✅ Phase 1 (Repository) - COMPLETE
3. ⬅️ **Phase 2 (React Hooks)** - START HERE
4. Phase 3 (UI Components - can parallelize shadcn install)
5. Phase 4 (Pages - needs Phase 2 + 3)
6. Phase 5 (Drawing Logic - needs Phase 4)
7. Phase 6 (Theme & Polish - can parallelize theme work)
8. Phase 7 (Testing & Deployment - final)

**Estimated remaining:** 3-4 days focused work

---

## Quick Start for New Session

```bash
# 1. Verify environment
pnpm build              # Should pass with 0 errors
npx tsx src/scripts/test-repository.ts  # Should show 15/15 tests passing

# 2. Start Phase 2
mkdir -p src/hooks
# Create hooks following patterns in handoff

# 3. Test hooks
pnpm dev
# Create test component, verify real-time updates work
```

**Next immediate task:** Create `src/hooks/useRoom.ts` following the pattern above.
