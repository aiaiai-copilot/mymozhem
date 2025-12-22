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

// Auto-import game types (will be populated later)
// import { classicGame } from './classic'
// registerGameType(classicGame)
