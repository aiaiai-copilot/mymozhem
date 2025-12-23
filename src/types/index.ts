// Core data types based on PRD
// These use camelCase for application layer (transformed from database snake_case)

export interface Room {
  id: string
  publicId: string
  secretId: string
  name: string
  registrationOpen: boolean
  status: 'waiting' | 'drawing' | 'finished'
  currentPrizeIndex: number
  createdAt: Date
  settings: RoomSettings
}

export interface RoomSettings {
  gameType: string
  visualization: string
  theme: string
  prizeOrder: 'small-to-large' | 'large-to-small' | 'random'
}

export interface Prize {
  id: string
  roomId: string
  name: string
  description?: string
  sortOrder: number
  winnerId?: string
  createdAt: Date
}

export interface Participant {
  id: string
  roomId: string
  name: string
  joinedAt: Date
  hasWon: boolean
  prizeId?: string
}

export interface WinnerResult {
  participantId: string;
  participantName: string;
  prizeId: string;
  prizeName: string;
}

// Plugin interfaces

export interface GameType {
  id: string;
  name: string;
  configure(settings: GameSettings): void;
  selectWinners(participants: Participant[], prizes: Prize[]): WinnerResult[];
}

export interface GameSettings {
  [key: string]: unknown;
}

export interface WinnerVisualization {
  id: string;
  name: string;
  animate(winner: WinnerResult, container: HTMLElement): Promise<void>;
}

export interface AppTheme {
  id: string;
  name: string;
  styles: ThemeStyles;
  assets: ThemeAssets;
}

export interface ThemeStyles {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  accentColor: string;
  [key: string]: string;
}

export interface ThemeAssets {
  logo?: string;
  background?: string;
  [key: string]: string | undefined;
}

// Repository types

export interface CreateRoomData {
  name: string;
  settings?: Partial<RoomSettings>;
}
