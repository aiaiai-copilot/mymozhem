import { GameType, GameSettings, Participant, Prize, WinnerResult } from '@/types'

export const classicGame: GameType = {
  id: 'classic',
  name: 'Classic Lottery',

  configure(settings: GameSettings): void {
    // Configuration logic will be implemented later
  },

  selectWinners(participants: Participant[], prizes: Prize[]): WinnerResult[] {
    // Simple random selection algorithm (will be enhanced later)
    const availableParticipants = [...participants.filter(p => !p.hasWon)]
    const results: WinnerResult[] = []

    for (const prize of prizes) {
      if (availableParticipants.length === 0) break

      const randomIndex = Math.floor(Math.random() * availableParticipants.length)
      const winner = availableParticipants[randomIndex]

      results.push({
        participantId: winner.id,
        participantName: winner.name,
        prizeId: prize.id,
        prizeName: prize.name,
      })

      availableParticipants.splice(randomIndex, 1)
    }

    return results
  },
}
