# MyMozhem Lottery v0.1 - Implementation Plan

## Session Handoff Summary

**Project:** MyMozhem - Interactive entertainment platform for events
**Current Module:** Lottery (first game, prototype v0.1)
**Repository:** https://github.com/aiaiai-copilot/mymozhem
**Status:** Phase 4 complete, ready for Phase 5 (Drawing Logic)
**Branch:** master
**Latest Work:** All page components implemented and tested

### What's Done

**Foundation (Phases 0-4 Complete):**
- ✅ Project scaffolding (Vite + React + TypeScript + Supabase)
- ✅ Git repository initialized and pushed to GitHub
- ✅ Complete type system (Room, Prize, Participant, plugins)
- ✅ Repository pattern fully implemented
- ✅ Plugin architecture designed (games, visualizations, themes)
- ✅ i18n system with complete Russian translations
- ✅ Project rebranded as multi-game platform
- ✅ PRD documentation complete
- ✅ Specialized agents configured

**Phase 0 - Database & Schema: ✅ COMPLETE**
- ✅ Fixed 29 TypeScript build errors
- ✅ Supabase project created ("mymozhem", us-west-2)
- ✅ Database migration applied successfully
- ✅ Tables: rooms, prizes, participants (with RLS + Realtime)
- ✅ Case-insensitive unique name constraint working
- ✅ Cascade delete verified
- ✅ Database type definitions (`src/types/database.ts`)
- ✅ Type mappers (`src/lib/mappers.ts`)

**Phase 1 - Repository Implementation: ✅ COMPLETE**
- ✅ All CRUD methods implemented
- ✅ Public ID generation (NY2025-XXX format)
- ✅ Realtime subscriptions (rooms, prizes, participants)
- ✅ Auto-incrementing prize sort_order
- ✅ Validation test script (15/15 tests passing)
- ✅ Supabase client supports Vite + Node.js

**Phase 2 - React Hooks: ✅ COMPLETE**
- ✅ Data hooks implemented (5 hooks):
  - `useRoom.ts` - Fetch + subscribe to room by ID
  - `useRoomByPublicId.ts` - For participant view
  - `useRoomBySecretId.ts` - For admin dashboard
  - `usePrizes.ts` - Real-time prize list
  - `useParticipants.ts` - Real-time participant list
- ✅ Action hooks implemented (3 hooks):
  - `useRoomActions.ts` - createRoom, updateRoom, deleteRoom
  - `usePrizeActions.ts` - addPrize, updatePrize, deletePrize
  - `useParticipantActions.ts` - addParticipant, updateParticipant
- ✅ Test component created (`HookTest.tsx`)
- ✅ All hooks follow project patterns with loading/error states
- ✅ TypeScript builds with 0 errors

**Phase 3 - UI Components: ✅ COMPLETE**
- ✅ shadcn/ui components installed (button, input, card, dialog, label, badge, separator, skeleton, toast)
- ✅ Lottery components (8 components):
  - `RoomCreationForm.tsx` - Create new lottery room with validation
  - `RoomInfoCard.tsx` - Display room info with QR code (uses qrcode.react)
  - `PrizeList.tsx` - List prizes with winners, sorted by sortOrder
  - `PrizeForm.tsx` - Add/edit prize dialog
  - `ParticipantList.tsx` - Real-time participant list with winner badges
  - `ParticipantRegistration.tsx` - Join room form with duplicate name handling
  - `DrawingControls.tsx` - Start drawing button with validation
  - `WinnerDisplay.tsx` - Animated winner reveal (uses framer-motion)
- ✅ Admin components (4 components):
  - `DashboardLayout.tsx` - Admin dashboard layout with header/sections
  - `PrizeManagement.tsx` - Combines PrizeList and PrizeForm
  - `ParticipantManagement.tsx` - Participant list with registration toggle
  - `DrawingPanel.tsx` - Drawing controls and results display
- ✅ Dependencies installed: qrcode.react, framer-motion
- ✅ All components use i18n for text
- ✅ All components follow project conventions (named exports, TypeScript, mobile-first)
- ✅ TypeScript builds with 0 errors

**Phase 4 - Pages: ✅ COMPLETE**
- ✅ Toaster component added to App.tsx
- ✅ Landing page (`Landing.tsx`):
  - Clean, centered layout with New Year theme
  - Room creation form with validation
  - Navigation to admin dashboard on success
  - Mobile-responsive design
- ✅ Admin Dashboard (`AdminDashboard.tsx`):
  - Loads room via secretId from URL params
  - Four sections: Room Info, Prizes, Participants, Drawing
  - QR code generation and public link sharing
  - Real-time updates for prizes and participants
  - Registration toggle functionality
  - Loading states with Skeleton components
  - Error handling for invalid secretId
- ✅ Participant Room (`ParticipantRoom.tsx`):
  - Loads room via publicId from URL params
  - State machine based on room status:
    - `waiting + registrationOpen` → Registration form
    - `waiting + !registrationOpen` → Waiting screen
    - `drawing` → Winner display (ready for Phase 5)
    - `finished` → Results with all winners
  - Real-time participant list updates
  - Mobile-responsive design
  - Error handling for invalid publicId
- ✅ All pages use i18n for text
- ✅ Component props fixed and validated
- ✅ TypeScript builds with 0 errors

### Current Status

**What Works:**
- ✅ TypeScript builds with 0 errors
- ✅ Complete data layer (repository + database)
- ✅ All repository methods tested and validated
- ✅ Realtime synchronization functional
- ✅ Complete React hooks for data management
- ✅ All UI components implemented and building
- ✅ All page components implemented and wired up
- ✅ Full navigation flow working (Landing → Admin → Participant)
- ✅ QR code generation working
- ✅ Real-time updates across multiple windows
- ✅ Environment variables configured (.env)

**What's Missing:**
- ❌ No drawing logic implementation (Phase 5)
- ❌ Plugins not registered (games, visualizations, themes)
- ❌ No winner animation coordination
- ❌ Theme not fully applied (Phase 6)
- ❌ Some i18n text still says "lottery" instead of generic "room"

### Immediate Next Steps

**Priority 1: Generic i18n Text (Option A - 30 min)**

Make UI text generic to support future game types while keeping v0.1 as lottery prototype:

Update `src/i18n/ru.ts`:
```typescript
landing: {
  title: 'MyMozhem',
  subtitle: 'Интерактивные развлечения для мероприятий',  // Already generic ✓
  createRoom: 'Создать комнату',  // Changed from 'Создать лотерею'
  description: 'Создайте комнату для вашего мероприятия',  // Changed
},
room: {
  create: {
    title: 'Создание комнаты',  // Changed from 'Создание лотереи'
    roomName: 'Название',  // Already generic ✓
    roomNamePlaceholder: 'Новогодняя лотерея 2025',  // Specific example is OK
  },
  // ... rest unchanged
}
```

**Note:** Architecture already supports multiple game types via plugin system. This change just makes UI text more generic. Default gameType remains 'classic' (lottery).

**Priority 2: Phase 5 - Drawing Logic (3-4 hours)**

Implement the drawing flow to make the lottery functional:

1. **Create Drawing Hook** (`src/hooks/useDrawing.ts`):
   - Validate: at least 1 prize, at least 1 participant, registration closed
   - Start: Set room.status = 'drawing', currentPrizeIndex = 0
   - For each prize (by sortOrder):
     - Select random eligible participant (not already won)
     - Update participant: hasWon = true, prizeId
     - Update prize: winnerId
     - Wait 3-5 seconds for animation
     - Increment room.currentPrizeIndex
   - End: Set room.status = 'finished'

2. **Register Plugins**:
   - Uncomment in `src/plugins/games/index.ts`
   - Uncomment in `src/plugins/visualizations/index.ts`
   - Uncomment in `src/plugins/themes/index.ts`

3. **Wire Drawing to AdminDashboard**:
   - Replace `handleStartDrawing` placeholder with actual hook
   - Add error handling and validation
   - Show progress/status during drawing

4. **Test Multi-Device Drawing**:
   - Open admin in one window
   - Open participant in another
   - Verify both see winner reveal simultaneously

### Architecture Notes

**Multi-Game Support Status:**

The system is **architecturally ready** for multiple game types:

✅ **Data Model:**
- `Room.settings.gameType` field exists
- Default: 'classic' (lottery)
- Supports any game type string

✅ **Plugin System:**
- `GameType` interface defined
- Registry functions ready: `registerGameType()`, `getGameType()`, `getAllGameTypes()`
- Currently only `classic.ts` implemented

✅ **Repository Layer:**
- Creates generic "rooms" (not "lotteries")
- Game type stored in settings JSONB column

❌ **UI Layer (v0.1):**
- RoomCreationForm doesn't have game type selector (using default)
- Some i18n text says "lottery" (being changed to "room")
- Components work for any prize-based game

**Adding New Game Type (Future v0.2+):**
1. Create `src/plugins/games/secret-santa.ts`
2. Implement `GameType` interface
3. Register in `src/plugins/games/index.ts`
4. Add game type selector to RoomCreationForm
5. Add game-specific UI/instructions if needed

**Current Decision:** Keep v0.1 simple with single game type (lottery), make UI text generic, add game type selection in v0.2 after core functionality proven.

### Key Files to Know

**Phase 4 - Pages** (3 files):
- `src/pages/Landing.tsx` - Landing page with room creation
- `src/pages/AdminDashboard.tsx` - Admin dashboard with all sections
- `src/pages/ParticipantRoom.tsx` - Participant view with state machine
- `src/App.tsx` - Routing and Toaster

**Phase 3 - Components** (14 files):
- `src/components/lottery/RoomCreationForm.tsx`
- `src/components/lottery/RoomInfoCard.tsx`
- `src/components/lottery/PrizeList.tsx`
- `src/components/lottery/PrizeForm.tsx`
- `src/components/lottery/ParticipantList.tsx`
- `src/components/lottery/ParticipantRegistration.tsx`
- `src/components/lottery/DrawingControls.tsx`
- `src/components/lottery/WinnerDisplay.tsx`
- `src/components/lottery/index.ts`
- `src/components/admin/DashboardLayout.tsx`
- `src/components/admin/PrizeManagement.tsx`
- `src/components/admin/ParticipantManagement.tsx`
- `src/components/admin/DrawingPanel.tsx`
- `src/components/admin/index.ts`

**Phase 2 - Hooks** (8 files):
- `src/hooks/useRoom.ts`
- `src/hooks/useRoomByPublicId.ts`
- `src/hooks/useRoomBySecretId.ts`
- `src/hooks/usePrizes.ts`
- `src/hooks/useParticipants.ts`
- `src/hooks/useRoomActions.ts`
- `src/hooks/usePrizeActions.ts`
- `src/hooks/useParticipantActions.ts`
- `src/hooks/use-toast.ts` (shadcn)

**Phase 1 - Repository & Types:**
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
- `src/components/test/HookTest.tsx` - Phase 2 hook testing

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

## Phase 5: Drawing Logic ⬅️ START HERE

### 1. Update i18n for Generic Text (30 min)

**File:** `src/i18n/ru.ts`

Change lottery-specific text to generic room text:

```typescript
export const ru = {
  common: {
    // ... unchanged
  },
  landing: {
    title: 'MyMozhem',
    subtitle: 'Интерактивные развлечения для мероприятий',
    createRoom: 'Создать комнату',  // Changed from createLottery
    description: 'Создайте комнату для вашего мероприятия',  // Changed
  },
  room: {
    create: {
      title: 'Создание комнаты',  // Changed from 'Создание лотереи'
      roomName: 'Название',
      roomNamePlaceholder: 'Новогодняя лотерея 2025',
    },
    created: {
      title: 'Комната создана!',
      publicLink: 'Ссылка для участников',
      adminLink: 'Ссылка организатора',
      copyLink: 'Скопировать ссылку',
      qrCode: 'QR код для входа',
    },
  },
  // ... rest unchanged
}
```

**Update Landing.tsx references:**
- Change `t.landing.createLottery` to `t.landing.createRoom`

### 2. Create Drawing Hook (`src/hooks/useDrawing.ts`)

**Implementation requirements:**

```typescript
import { useState, useCallback } from 'react'
import { useRoomActions } from './useRoomActions'
import { usePrizeActions } from './usePrizeActions'
import { useParticipantActions } from './useParticipantActions'
import { getGameType } from '@/plugins/games'
import type { Room, Prize, Participant } from '@/types'

export function useDrawing(
  room: Room,
  prizes: Prize[],
  participants: Participant[]
) {
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentPrizeIndex, setCurrentPrizeIndex] = useState(0)
  const [error, setError] = useState<Error | null>(null)

  const { updateRoom } = useRoomActions()
  const { updatePrize } = usePrizeActions()
  const { updateParticipant } = useParticipantActions()

  const validate = useCallback(() => {
    if (prizes.length === 0) {
      throw new Error('No prizes to draw')
    }
    if (participants.length === 0) {
      throw new Error('No participants')
    }
    if (room.registrationOpen) {
      throw new Error('Registration must be closed')
    }
  }, [prizes, participants, room.registrationOpen])

  const startDrawing = useCallback(async () => {
    try {
      validate()
      setIsDrawing(true)
      setError(null)

      // Set room status to drawing
      await updateRoom(room.id, { status: 'drawing', currentPrizeIndex: 0 })

      // Get game type plugin
      const gameType = getGameType(room.settings.gameType)
      if (!gameType) {
        throw new Error(`Game type ${room.settings.gameType} not found`)
      }

      // Sort prizes by sortOrder
      const sortedPrizes = [...prizes].sort((a, b) => a.sortOrder - b.sortOrder)

      // Draw for each prize
      for (let i = 0; i < sortedPrizes.length; i++) {
        const prize = sortedPrizes[i]
        setCurrentPrizeIndex(i)

        // Update room's current prize index
        await updateRoom(room.id, { currentPrizeIndex: i })

        // Get eligible participants (not already won)
        const eligibleParticipants = participants.filter(p => !p.hasWon)

        if (eligibleParticipants.length === 0) {
          throw new Error('No more eligible participants')
        }

        // Use game type to select winner(s)
        const results = gameType.selectWinners(eligibleParticipants, [prize])
        const winner = results[0]

        if (!winner) {
          throw new Error('No winner selected')
        }

        // Update participant
        await updateParticipant(winner.participantId, {
          hasWon: true,
          prizeId: prize.id,
        })

        // Update prize
        await updatePrize(prize.id, {
          winnerId: winner.participantId,
        })

        // Wait for animation (3-5 seconds)
        await new Promise(resolve => setTimeout(resolve, 4000))
      }

      // Set room status to finished
      await updateRoom(room.id, { status: 'finished' })

      setIsDrawing(false)
    } catch (err) {
      setError(err as Error)
      setIsDrawing(false)
      throw err
    }
  }, [room, prizes, participants, updateRoom, updatePrize, updateParticipant, validate])

  return {
    startDrawing,
    isDrawing,
    currentPrizeIndex,
    error,
  }
}
```

### 3. Register Classic Game Plugin

**File:** `src/plugins/games/index.ts`

Uncomment the imports:

```typescript
import { GameType } from '@/types'

const gameTypes = new Map<string, GameType>()

export function registerGameType(gameType: GameType) {
  gameTypes.set(gameType.id, gameType)
}

export function getGameType(id: string): GameType | undefined {
  return gameTypes.get(id)
}

export function getAllGameTypes(): GameType[] {
  return Array.from(gameTypes.values())
}

// Register game types
import { classicGame } from './classic'
registerGameType(classicGame)
```

### 4. Update AdminDashboard to Use Drawing Hook

**File:** `src/pages/AdminDashboard.tsx`

Replace placeholder with actual hook:

```typescript
import { useDrawing } from '@/hooks/useDrawing'

export function AdminDashboard() {
  // ... existing code ...

  const { startDrawing, isDrawing, error: drawingError } = useDrawing(
    room,
    prizes || [],
    participants || []
  )

  const handleStartDrawing = async () => {
    try {
      await startDrawing()
      // Optional: show success toast
    } catch (err) {
      console.error('Drawing failed:', err)
      // Optional: show error toast
    }
  }

  // ... rest of component
}
```

### 5. Validation Strategy

**Multi-Window Testing (CRITICAL):**

1. **Setup:**
   - Window A: Admin dashboard (`/admin/:secretId`)
   - Window B: Participant room (`/room/:publicId`)
   - Window C: Another participant (optional)

2. **Test Sequence:**
   - Add 3 prizes in admin
   - Join as 3+ participants
   - Close registration in admin
   - Verify participant sees "waiting" screen
   - Click "Start Drawing" in admin
   - **Both windows should show:**
     - Prize 1 winner reveal (4 seconds)
     - Prize 2 winner reveal (4 seconds)
     - Prize 3 winner reveal (4 seconds)
     - Final results screen

3. **Verify:**
   - ✓ Winner reveals are synchronized
   - ✓ Each participant wins maximum once
   - ✓ All prizes are assigned
   - ✓ Room status changes to 'finished'
   - ✓ Results screen shows all winners

**Database Verification:**
- Check participants table: hasWon = true, prizeId set
- Check prizes table: winnerId set
- Check rooms table: status = 'finished'

---

## Phase 6: Theme & Polish

### New Year Theme
**Agent:** `theme-designer`

- Enhance `src/plugins/themes/new-year.ts` with full CSS variables
- Add snowflake SVG animations to `src/index.css`
- Gold accents (#FFD700), blue gradients (#1E3A8A to #3B82F6)
- Festive typography (consider Google Fonts)
- Apply theme to all pages

### Error Handling
- Toast notifications for actions (use useToast hook)
- Better error messages for drawing failures
- Loading indicators during drawing
- Graceful handling of network issues

### Mobile Responsiveness
- Test all pages at 375px width (iPhone SE)
- Test QR code scanning on real device
- Touch-friendly buttons (44x44px min)
- Test on iOS Safari, Android Chrome

---

## Phase 7: Testing & Deployment

### Testing
**Agent:** `test-writer`

**Critical Scenarios:**
1. Happy path: Create → Add prizes → Join → Draw → Results
2. Duplicate names (should fail with friendly message)
3. Registration closed (can't join)
4. Insufficient participants/prizes (can't start drawing)
5. Invalid URLs (404 handling)
6. Mid-drawing participant disconnect (resilience)

### Supabase Production
**Agent:** `supabase-schema`

- Use current project or create production project
- Run migrations in production
- Verify Realtime enabled
- Update env vars for production

### Vercel Deployment
- Connect GitHub repo to Vercel
- Set environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Deploy and test production build
- Verify HTTPS works
- Test on mobile devices
- Share with real users for feedback

---

## Success Criteria

- ✅ TypeScript builds without errors
- ✅ All repository methods implemented
- ✅ React hooks implemented
- ✅ UI components implemented
- ✅ Pages implemented and routing works
- ✅ Real-time updates work across devices
- ⬜ Complete lottery flow works end-to-end
- ⬜ Drawing syncs with animation
- ⬜ New Year theme applied
- ⬜ Works on mobile (iOS Safari, Android Chrome)
- ⬜ Deployed to Vercel

---

## Execution Order

1. ✅ Phase 0 (Database) - COMPLETE
2. ✅ Phase 1 (Repository) - COMPLETE
3. ✅ Phase 2 (React Hooks) - COMPLETE
4. ✅ Phase 3 (UI Components) - COMPLETE
5. ✅ Phase 4 (Pages) - COMPLETE
6. ⬅️ **Phase 5 (Drawing Logic)** - START HERE
7. Phase 6 (Theme & Polish)
8. Phase 7 (Testing & Deployment)

**Estimated remaining:** 1-2 days focused work

---

## Quick Start for New Session

```bash
# 1. Verify environment
pnpm build              # Should pass with 0 errors
npx tsx src/scripts/test-repository.ts  # Should show 15/15 tests passing

# 2. Test current state
pnpm dev
# Navigate to http://localhost:5173
# Create room → add prizes → join as participant → verify UI works

# 3. Start Phase 5
# a. Update i18n (make text generic)
# b. Create useDrawing.ts hook
# c. Register classic game plugin
# d. Wire hook to AdminDashboard
# e. Test multi-window drawing

# 4. Validation
# Open 2 windows, test full drawing flow
```

**Next immediate task:** Update `src/i18n/ru.ts` to use generic "room" text instead of "lottery".

---

## Important Notes

**Agent Usage:**
- Use `component-creator` agent for any new components
- Consult `react-components` skill for patterns
- Use `theme-designer` for New Year theme work
- Use `test-writer` for test creation

**Multi-Game Architecture:**
- ✅ System architecturally supports multiple game types
- ✅ Plugin registry ready for new games
- ✅ Data model supports gameType field
- ❌ UI only shows single game type (by design for v0.1)
- 📋 To add new game: create plugin, register, update UI selector (v0.2+)

**Testing Strategy:**
- Phase 5: Critical multi-device testing for drawing sync
- Real users testing recommended before Phase 7
- Test on real mobile devices (QR code scanning)

**Common Issues:**
- If hooks don't update: verify Realtime is enabled in Supabase
- If build fails: check all imports use `@/` path alias
- If types error: ensure database types are current
- If toast doesn't show: verify Toaster is in App.tsx
- If drawing doesn't sync: check Realtime WebSocket connection

**Performance Notes:**
- Current bundle: 582 KB (warning about chunk size)
- Consider code splitting in Phase 6 if needed
- Supabase Realtime handles sync efficiently
- 4-second delay per prize keeps animation smooth
