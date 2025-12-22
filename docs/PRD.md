# MyMozhem — Product Requirements Document

## Project Overview

**Project Name:** MyMozhem
**Brand:** MyMozhem ("Мы можем!" / "We Can!")
**Domain:** mymozhem.com
**Current Module:** Lottery (Prototype v0.1)
**Target Release:** New Year 2025 season

### Purpose

MyMozhem is an interactive entertainment platform for events, designed to host multiple game types and experiences. The lottery module is the first implementation — a web-based application for organizing prize drawings at events. The prototype features a New Year theme and serves as a portfolio showcase for freelance services on FL.ru.

### Business Goals

1. Demonstrate AI-driven development capabilities in portfolio
2. Offer as a seasonal service on FL.ru marketplace
3. Build foundation for a series of entertainment applications under MyMozhem brand

---

## Technical Stack

### Frontend
- **Build Tool:** Vite
- **Framework:** React 18+
- **UI Components:** shadcn/ui
- **Styling:** Tailwind CSS
- **Language:** TypeScript

### Backend
- **Platform:** Supabase
- **Realtime:** Supabase Realtime (for live synchronization)
- **Database:** PostgreSQL (via Supabase)

### Deployment
- **Hosting:** Vercel
- **Domain:** mymozhem.com (future)

### Development
- **AI Tool:** Claude Code

---

## Architecture Principles

### Plugin-Based Design

The application must support extensibility from day one:

1. **Game Types** — Different lottery mechanics (classic draw, Secret Santa, etc.)
2. **Visualizations** — Different winner reveal animations (name appearance, wheel, slot machine, card flip)
3. **Themes** — Visual themes (New Year, generic, seasonal)

Each extension point follows a common interface pattern:

```typescript
// Example: Game type interface
interface GameType {
  id: string;
  name: string;
  configure(settings: GameSettings): void;
  selectWinners(participants: Participant[], prizes: Prize[]): WinnerResult[];
}

// Example: Visualization interface
interface WinnerVisualization {
  id: string;
  name: string;
  animate(winner: Winner, container: HTMLElement): Promise<void>;
}

// Example: Theme interface
interface AppTheme {
  id: string;
  name: string;
  styles: ThemeStyles;
  assets: ThemeAssets;
}
```

### Data Layer Separation

Repository pattern for data access, enabling future migration from Supabase to custom backend:

```typescript
interface LotteryRepository {
  createRoom(data: CreateRoomData): Promise<Room>;
  getRoom(id: string): Promise<Room | null>;
  addParticipant(roomId: string, name: string): Promise<Participant>;
  // ... etc
}

// Prototype implementation
class SupabaseLotteryRepository implements LotteryRepository { ... }

// Future implementation
class ApiLotteryRepository implements LotteryRepository { ... }
```

### Internationalization Ready

All UI strings externalized from day one:

```typescript
// /src/i18n/ru.ts
export const ru = {
  common: {
    create: 'Создать',
    join: 'Присоединиться',
    // ...
  },
  lottery: {
    roomCreated: 'Комната создана!',
    enterName: 'Введите ваше имя',
    // ...
  }
};
```

**Prototype:** Russian only  
**Future:** Add English, other languages

---

## User Roles

### Organizer
- Creates lottery room
- Adds prizes with order (smallest to largest)
- Shares public link / QR code with participants
- Manually closes registration
- Initiates drawing
- Deletes room when finished

### Participant
- Joins room via link or QR code
- Enters display name (unique within room)
- Watches live drawing
- Sees results in realtime

---

## Application Routes

### `/` — Landing Page
- Brief description of the service
- "Create Lottery" button → leads to room creation

### `/admin/:secretId` — Organizer Dashboard
- **secretId** is a UUID, known only to organizer
- Room settings and status
- Prize list management (add/edit/remove/reorder)
- Participant list (realtime updates)
- Public link display + QR code generation
- Registration toggle (open/closed)
- "Start Drawing" button
- Drawing progress and results
- "Delete Room" action

### `/room/:publicId` — Participant View
- **publicId** is a short, shareable ID
- If registration open: name input form
- If registered: waiting screen with participant count
- During drawing: live visualization of winner selection
- After drawing: results display

---

## Data Model

### Room
```typescript
interface Room {
  id: string;                    // UUID, primary key
  publicId: string;              // Short ID for sharing (e.g., "NY2025-ABC")
  secretId: string;              // UUID for admin access
  name: string;                  // Room display name
  registrationOpen: boolean;     // Can participants join?
  status: 'waiting' | 'drawing' | 'finished';
  currentPrizeIndex: number;     // Which prize is being drawn
  createdAt: Date;
  settings: RoomSettings;
}

interface RoomSettings {
  gameType: string;              // Plugin ID (prototype: 'classic')
  visualization: string;         // Plugin ID (prototype: 'name-reveal')
  theme: string;                 // Plugin ID (prototype: 'new-year')
  prizeOrder: 'small-to-large' | 'large-to-small' | 'random';
}
```

### Prize
```typescript
interface Prize {
  id: string;
  roomId: string;
  name: string;
  description?: string;
  order: number;                 // Display/draw order
  winnerId?: string;             // Set after drawing
}
```

### Participant
```typescript
interface Participant {
  id: string;
  roomId: string;
  name: string;                  // Unique within room
  joinedAt: Date;
  hasWon: boolean;               // Excluded from further draws
  prizeId?: string;              // Won prize, if any
}
```

---

## Functional Requirements

### FR-01: Room Creation
- Organizer clicks "Create Lottery"
- System generates room with unique publicId and secretId
- Organizer is redirected to `/admin/:secretId`
- Registration is open by default

### FR-02: Prize Management
- Organizer can add prizes with name and optional description
- Prizes are ordered (drag-and-drop or manual numbering)
- Prototype default: smallest prize first, largest last
- Minimum 1 prize required to start drawing

### FR-03: Share Room
- Display public URL: `mymozhem.com/room/:publicId`
- Generate QR code for the same URL
- Copy-to-clipboard functionality

### FR-04: Participant Registration
- Participant opens public link or scans QR
- If registration open: show name input form
- Validate name uniqueness within room (case-insensitive)
- On duplicate: show error, ask for different name
- On success: join room, see waiting screen

### FR-05: Realtime Participant List
- Organizer sees participants appear in realtime
- Participant sees current participant count updating
- Uses Supabase Realtime subscriptions

### FR-06: Close Registration
- Organizer clicks "Close Registration"
- No new participants can join
- Existing participants remain
- Reversible action (can reopen)

### FR-07: Start Drawing
- Enabled when: registration closed AND at least 1 prize AND participants >= prizes
- Drawing proceeds prize by prize (smallest to largest in prototype)
- Each prize: random selection from remaining participants
- Winner is marked, excluded from future draws
- Realtime broadcast to all participants

### FR-08: Winner Visualization
- Prototype: "Dramatic name reveal" animation
- Name appears with visual effect (fade-in, particles, etc.)
- All participants see same animation in sync
- Brief pause between prize drawings

### FR-09: Results Display
- After all prizes drawn, show summary
- List of prizes with winner names
- Organizer can share/screenshot results

### FR-10: Room Deletion
- Organizer can delete room at any time
- Confirmation dialog required
- All data (room, prizes, participants) removed
- Participants see "Room no longer exists" message

---

## Non-Functional Requirements

### NFR-01: Responsive Design
- Mobile-first approach
- Fully functional on smartphones (iOS Safari, Android Chrome)
- Desktop support for organizer dashboard

### NFR-02: Performance
- Page load < 3 seconds on 3G
- Realtime updates < 500ms latency
- Smooth animations at 60fps

### NFR-03: Browser Support
- Modern browsers (last 2 versions)
- Chrome, Firefox, Safari, Edge

### NFR-04: Accessibility
- Semantic HTML
- Keyboard navigation for core flows
- Sufficient color contrast

---

## UI/UX Guidelines

### New Year Theme (Prototype)
- Color palette: deep blue, white, gold accents
- Snowflake decorations (subtle, non-distracting)
- Festive typography for headings
- Winner animation with sparkle/confetti effects

### General Principles
- Clean, modern interface (shadcn/ui defaults)
- Clear visual hierarchy
- Obvious call-to-action buttons
- Loading states for all async operations
- Error messages in user-friendly language

---

## Future Scope (Out of Prototype)

These features are architecturally planned but NOT implemented in prototype:

1. **Authentication** — Participant login (email, phone, social)
2. **Multiple Game Types** — Secret Santa, trivia-based, etc.
3. **Visualization Options** — Wheel of fortune, slot machine, card flip
4. **Theme Selection** — Generic, seasonal themes
5. **Prize Order Settings** — Organizer chooses order strategy
6. **Auto-close Registration** — Timer-based registration closing
7. **Room Expiration** — Auto-delete after N days
8. **Multi-language UI** — English and other languages
9. **Analytics** — Room statistics, participant engagement
10. **Custom Branding** — Organizer uploads logo/colors

---

## Success Metrics

### Prototype Launch
- [ ] Fully functional lottery flow end-to-end
- [ ] Realtime sync working across devices
- [ ] New Year theme applied
- [ ] Deployed to Vercel
- [ ] Demo video recorded for portfolio

### Post-Launch (30 days)
- At least 3 real lottery events conducted
- Positive feedback from test users
- At least 1 inquiry on FL.ru

---

## File Structure (Recommended)

```
/src
  /components
    /ui              # shadcn/ui components
    /lottery         # Lottery-specific components
    /admin           # Organizer dashboard components
    /room            # Participant view components
  /hooks
    useRoom.ts
    useParticipants.ts
    usePrizes.ts
    useRealtime.ts
  /lib
    supabase.ts      # Supabase client
    qrcode.ts        # QR generation
  /plugins
    /games
      index.ts       # Game type registry
      classic.ts     # Classic lottery implementation
    /visualizations
      index.ts       # Visualization registry
      name-reveal.ts # Dramatic name reveal
    /themes
      index.ts       # Theme registry
      new-year.ts    # New Year theme
  /repositories
    lottery.repository.ts
    supabase.lottery.repository.ts
  /i18n
    index.ts
    ru.ts
  /types
    index.ts
  /pages (or routes)
    Landing.tsx
    AdminDashboard.tsx
    ParticipantRoom.tsx
  App.tsx
  main.tsx
```

---

## Development Phases

### Phase 1: Foundation (Day 1)
- Project setup (Vite + React + TypeScript)
- Supabase project creation
- Database schema
- Basic routing
- shadcn/ui installation

### Phase 2: Core Flow (Days 2-3)
- Room creation
- Prize management
- Participant registration
- Realtime subscriptions

### Phase 3: Drawing Logic (Day 4)
- Random selection algorithm
- Winner assignment
- State machine for drawing flow

### Phase 4: Visualization & Theme (Day 5)
- Winner reveal animation
- New Year styling
- QR code generation

### Phase 5: Polish & Deploy (Day 6)
- Error handling
- Loading states
- Responsive testing
- Vercel deployment

---

## Appendix: Supabase Schema

```sql
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
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL,
  winner_id UUID REFERENCES participants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Participants table
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  has_won BOOLEAN DEFAULT false,
  prize_id UUID REFERENCES prizes(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, LOWER(name))
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE prizes;
ALTER PUBLICATION supabase_realtime ADD TABLE participants;

-- RLS policies (basic, public access for prototype)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Public insert rooms" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update rooms" ON rooms FOR UPDATE USING (true);
CREATE POLICY "Public delete rooms" ON rooms FOR DELETE USING (true);

CREATE POLICY "Public read prizes" ON prizes FOR SELECT USING (true);
CREATE POLICY "Public insert prizes" ON prizes FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update prizes" ON prizes FOR UPDATE USING (true);
CREATE POLICY "Public delete prizes" ON prizes FOR DELETE USING (true);

CREATE POLICY "Public read participants" ON participants FOR SELECT USING (true);
CREATE POLICY "Public insert participants" ON participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update participants" ON participants FOR UPDATE USING (true);
```

---

*Document prepared for AI-driven development with Claude Code + Sonnet 4.5*
