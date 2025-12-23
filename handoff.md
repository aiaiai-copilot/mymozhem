# MyMozhem Lottery v0.1 - Implementation Plan

## Session Handoff Summary

**Project:** MyMozhem - Interactive entertainment platform for events
**Current Module:** Lottery (first game, prototype v0.1)
**Repository:** https://github.com/aiaiai-copilot/mymozhem
**Status:** Foundation complete, ready for feature implementation
**Branch:** master (2 commits pushed)

### What's Done
- ✅ Project scaffolding (Vite + React + TypeScript + Supabase)
- ✅ Git repository initialized and pushed to GitHub
- ✅ Complete type system (Room, Prize, Participant, plugins)
- ✅ Repository pattern interface defined
- ✅ Plugin architecture designed (games, visualizations, themes)
- ✅ i18n system with complete Russian translations
- ✅ Project rebranded as multi-game platform (not just lottery)
- ✅ PRD documentation complete
- ✅ Specialized agents configured (component-creator, supabase-schema, etc.)

### Current Blockers
- ❌ **29 TypeScript build errors** - All unused parameters in stub methods
- ❌ **No Supabase database** - Tables don't exist yet
- ❌ **No repository implementation** - All methods throw "Not implemented"
- ❌ **No UI components** - Components directory is empty
- ❌ **No working features** - Pages are static placeholders

### Immediate Next Steps
1. **Fix TypeScript errors** (15 min) - Prefix unused params with underscore
2. **Create database schema** (30 min) - Use `supabase-schema` agent
3. **Implement repository** (2-3 hours) - Core CRUD operations
4. **Build UI components** (3-4 hours) - Use `component-creator` agent

### Key Files to Know
- `docs/PRD.md` - Complete requirements (source of truth)
- `CLAUDE.md` - Development guidelines and agent usage
- `src/types/index.ts` - All TypeScript interfaces
- `src/repositories/lottery.repository.ts` - Interface to implement
- `src/repositories/supabase.lottery.repository.ts` - Stub implementation
- `src/i18n/ru.ts` - All UI strings (Russian only for v0.1)

### Architecture Principles
1. Plugin-based extensibility (games, visualizations, themes)
2. Repository pattern for data access abstraction
3. All UI strings through i18n (no hardcoded text)
4. Mobile-first responsive design
5. Real-time synchronization via Supabase Realtime

### Dependencies Installed
- React, TypeScript, Vite (build tools)
- Supabase client, Realtime
- shadcn/ui, Tailwind CSS (UI framework)
- framer-motion (animations)
- qrcode.react (QR generation)
- react-router-dom (routing)
- Vitest, Testing Library (testing)

---

## Overview

Complete the lottery prototype with full end-to-end functionality: room creation, prize management, participant registration, real-time synchronization, and drawing with animations.

---

## Phase 0: Foundation (CRITICAL - DO FIRST)

### Fix TypeScript Build Errors
**Files:**
- `src/repositories/supabase.lottery.repository.ts`
- `src/plugins/games/classic.ts`

**Action:** Prefix all 29 unused parameters with underscore (`data` → `_data`)

### Database Schema Setup
**Agent:** `supabase-schema`

**Tables to create:**
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
  joined_at TIMESTAMPTZ,
  UNIQUE(room_id, LOWER(name))
)
```

**Enable:**
- RLS policies (public access for prototype)
- Realtime on all tables
- Indexes on public_id, secret_id

---

## Phase 1: Repository Implementation

### Implement All CRUD Methods
**File:** `src/repositories/supabase.lottery.repository.ts`

**Priority order:**
1. `createRoom()` - Generate publicId format "NY2025-XXX", secretId UUID
2. `getRoom()`, `getRoomByPublicId()`, `getRoomBySecretId()`
3. `updateRoom()` - Status changes, registration toggle
4. `addPrize()`, `getPrizes()`, `updatePrize()`, `deletePrize()`
5. `addParticipant()` - Check name uniqueness (case-insensitive)
6. `getParticipants()`, `updateParticipant()`
7. `deleteRoom()` - Cascade handled by DB

**Critical:** Map snake_case DB ↔ camelCase TypeScript

### Implement Realtime Subscriptions
**Consult:** `supabase-realtime` skill first

**Methods:**
- `subscribeToRoom(roomId, callback)` - Room status updates
- `subscribeToPrizes(roomId, callback)` - Prize changes
- `subscribeToParticipants(roomId, callback)` - Participant joins/wins

**Pattern:**
```typescript
const channel = supabase
  .channel(`room:${roomId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
    payload => callback(mapToRoom(payload.new)))
  .subscribe()

return () => { channel.unsubscribe() }
```

---

## Phase 2: React Hooks

### Data Hooks (Create in `src/hooks/`)
1. `useRoom.ts` - Fetch + subscribe to room by ID
2. `useRoomByPublicId.ts` - For participant view
3. `useRoomBySecretId.ts` - For admin view
4. `usePrizes.ts` - Real-time prize list
5. `useParticipants.ts` - Real-time participant list

**Pattern:**
```typescript
export function useRoom(roomId: string | undefined) {
  const [room, setRoom] = useState<Room | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!roomId) return
    lotteryRepository.getRoom(roomId).then(setRoom)
    const unsub = lotteryRepository.subscribeToRoom(roomId, setRoom)
    return unsub
  }, [roomId])

  return { room, loading }
}
```

### Action Hooks
1. `useRoomActions.ts` - createRoom, updateRoom, deleteRoom
2. `usePrizeActions.ts` - addPrize, updatePrize, deletePrize
3. `useParticipantActions.ts` - addParticipant

---

## Phase 3: UI Components

### Install shadcn/ui Components
**Agent:** `component-creator`

Run: `npx shadcn@latest add button input card dialog label badge separator skeleton`

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

### Phase 0 Validation ✓
```bash
pnpm build  # Must pass with 0 errors
```
- ✓ TypeScript compiles successfully
- ✓ Supabase tables exist (verify via Supabase dashboard or SQL query)
- ✓ RLS policies enabled on all tables
- ✓ Realtime enabled on rooms, prizes, participants
- ✓ Indexes created on public_id, secret_id

### Phase 1 Validation ✓
**Create test script:** `src/scripts/test-repository.ts`

```typescript
// Quick validation of repository methods
const room = await lotteryRepository.createRoom({ name: 'Test Room' })
console.log('✓ Room created:', room.publicId)

const fetched = await lotteryRepository.getRoomByPublicId(room.publicId)
console.log('✓ Room fetched:', fetched?.name)

const prize = await lotteryRepository.addPrize(room.id, { name: 'Test Prize', sortOrder: 1 })
console.log('✓ Prize added:', prize.id)

const participant = await lotteryRepository.addParticipant(room.id, { name: 'Alice' })
console.log('✓ Participant added:', participant.name)

// Test uniqueness constraint
try {
  await lotteryRepository.addParticipant(room.id, { name: 'alice' }) // lowercase
  console.log('✗ FAIL: Should reject duplicate name')
} catch (e) {
  console.log('✓ Uniqueness constraint works')
}

// Test realtime subscription
const unsub = lotteryRepository.subscribeToRoom(room.id, (updated) => {
  console.log('✓ Realtime update received:', updated.status)
})
await lotteryRepository.updateRoom(room.id, { status: 'drawing' })
setTimeout(unsub, 2000)
```

**Run:** `npx tsx src/scripts/test-repository.ts`

**Checklist:**
- ✓ All CRUD operations work
- ✓ Case-insensitive name uniqueness enforced
- ✓ Realtime subscriptions fire on updates
- ✓ Snake_case ↔ camelCase mapping correct
- ✓ No TypeScript errors

### Phase 2 Validation ✓
**Create test component:** `src/components/test/HookTest.tsx`

```typescript
export function HookTest() {
  const { room } = useRoomByPublicId('NY2025-001')
  const { prizes } = usePrizes(room?.id)
  const { participants } = useParticipants(room?.id)

  return (
    <div>
      <p>Room: {room?.name || 'Loading...'}</p>
      <p>Prizes: {prizes?.length || 0}</p>
      <p>Participants: {participants?.length || 0}</p>
    </div>
  )
}
```

**Add to App.tsx temporarily, run `pnpm dev`**

**Checklist:**
- ✓ Hooks load data correctly
- ✓ Real-time updates reflect in UI (update DB via Supabase dashboard)
- ✓ Loading states work
- ✓ No console errors

### Phase 3-4 Validation ✓
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

### Phase 5 Validation ✓ (CRITICAL)
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

### Phase 6 Validation ✓
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

### Phase 7 Validation ✓
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

1. `src/repositories/supabase.lottery.repository.ts` - Core data layer
2. `src/hooks/useRoom.ts` - Primary room state management
3. `src/pages/AdminDashboard.tsx` - Organizer interface
4. `src/pages/ParticipantRoom.tsx` - Participant interface
5. `src/hooks/useDrawing.ts` - Drawing orchestration

---

## Success Criteria

- TypeScript builds without errors
- All repository methods implemented
- Real-time updates work across devices
- Complete lottery flow works end-to-end
- Drawing syncs with animation
- New Year theme applied
- Works on mobile (iOS Safari, Android Chrome)
- Deployed to Vercel

---

## Execution Order

1. Phase 0 (CRITICAL BLOCKER)
2. Phase 1 → Phase 2 (sequential)
3. Phase 3 (can parallelize shadcn install)
4. Phase 4 (needs Phase 2 + 3)
5. Phase 5 (needs Phase 4)
6. Phase 6 (can parallelize theme work)
7. Phase 7 (final)

**Estimated:** 4-5 days focused work
