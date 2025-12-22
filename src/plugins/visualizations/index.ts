import { WinnerVisualization } from '@/types'

const visualizations = new Map<string, WinnerVisualization>()

export function registerVisualization(visualization: WinnerVisualization) {
  visualizations.set(visualization.id, visualization)
}

export function getVisualization(id: string): WinnerVisualization | undefined {
  return visualizations.get(id)
}

export function getAllVisualizations(): WinnerVisualization[] {
  return Array.from(visualizations.values())
}

// Auto-import visualizations (will be populated later)
// import { nameReveal } from './name-reveal'
// registerVisualization(nameReveal)
