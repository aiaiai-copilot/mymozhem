import { WinnerVisualization, WinnerResult } from '@/types'

export const nameReveal: WinnerVisualization = {
  id: 'name-reveal',
  name: 'Dramatic Name Reveal',

  async animate(winner: WinnerResult, container: HTMLElement): Promise<void> {
    // Simple animation stub - will be enhanced with framer-motion later
    return new Promise((resolve) => {
      const winnerElement = document.createElement('div')
      winnerElement.className = 'text-4xl font-bold text-center animate-fade-in'
      winnerElement.textContent = winner.participantName

      container.innerHTML = ''
      container.appendChild(winnerElement)

      setTimeout(resolve, 2000)
    })
  },
}
