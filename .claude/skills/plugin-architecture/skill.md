---
name: plugin-architecture
description: Plugin architecture for MyMozhem extensibility. Use when creating new game types, visualizations, or themes. Defines interfaces and registration patterns for pluggable modules.
---

# Plugin Architecture Skill

How to create and register plugins in MyMozhem.

## Plugin Types

1. **Game Types** — Different lottery mechanics (classic, secret santa, etc.)
2. **Visualizations** — Winner reveal animations (name reveal, wheel, etc.)
3. **Themes** — Visual styling (New Year, generic, seasonal)

## Core Interfaces

```typescript
// src/types/plugins.ts

// ===== Game Types =====
export interface GameType {
  id: string
  name: string
  description: string
  
  /** Validate game configuration */
  validateConfig(settings: GameSettings): ValidationResult
  
  /** Check if drawing can start */
  canStart(participants: Participant[], prizes: Prize[]): ValidationResult
  
  /** Select winners for all prizes */
  selectWinners(participants: Participant[], prizes: Prize[]): WinnerSelection[]
}

export interface WinnerSelection {
  prizeId: string
  participantId: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

// ===== Visualizations =====
export interface WinnerVisualization {
  id: string
  name: string
  description: string
  
  /** Estimated duration in milliseconds */
  duration: number
  
  /** React component for the animation */
  Component: React.ComponentType<VisualizationProps>
}

export interface VisualizationProps {
  winner: {
    name: string
    prize: string
  }
  onComplete: () => void
}

// ===== Themes =====
export interface AppTheme {
  id: string
  name: string
  
  colors: ThemeColors
  effects: ThemeEffects
  assets: ThemeAssets
}

export interface ThemeColors {
  primary: string
  secondary: string
  background: string
  surface: string
  text: string
  textMuted: string
  accent: string
  success: string
  error: string
}

export interface ThemeEffects {
  snowfall?: boolean
  sparkles?: boolean
  confettiOnWin?: boolean
}

export interface ThemeAssets {
  logo?: string
  background?: string
  winnerFrame?: string
}
```

## Plugin Registry

```typescript
// src/plugins/registry.ts
import type { GameType, WinnerVisualization, AppTheme } from '@/types/plugins'

class PluginRegistry {
  private games = new Map<string, GameType>()
  private visualizations = new Map<string, WinnerVisualization>()
  private themes = new Map<string, AppTheme>()

  // Games
  registerGame(game: GameType): void {
    this.games.set(game.id, game)
  }
  
  getGame(id: string): GameType | undefined {
    return this.games.get(id)
  }
  
  listGames(): GameType[] {
    return Array.from(this.games.values())
  }

  // Visualizations
  registerVisualization(viz: WinnerVisualization): void {
    this.visualizations.set(viz.id, viz)
  }
  
  getVisualization(id: string): WinnerVisualization | undefined {
    return this.visualizations.get(id)
  }
  
  listVisualizations(): WinnerVisualization[] {
    return Array.from(this.visualizations.values())
  }

  // Themes
  registerTheme(theme: AppTheme): void {
    this.themes.set(theme.id, theme)
  }
  
  getTheme(id: string): AppTheme | undefined {
    return this.themes.get(id)
  }
  
  listThemes(): AppTheme[] {
    return Array.from(this.themes.values())
  }
}

export const pluginRegistry = new PluginRegistry()
```

## Example: Classic Lottery Game

```typescript
// src/plugins/games/classic.ts
import type { GameType, Participant, Prize, WinnerSelection } from '@/types'

export const classicLottery: GameType = {
  id: 'classic',
  name: 'Классическая лотерея',
  description: 'Случайный выбор победителей для каждого приза',

  validateConfig(_settings) {
    return { valid: true }
  },

  canStart(participants, prizes) {
    if (participants.length === 0) {
      return { valid: false, error: 'Нет участников' }
    }
    if (prizes.length === 0) {
      return { valid: false, error: 'Нет призов' }
    }
    if (participants.length < prizes.length) {
      return { valid: false, error: 'Участников меньше, чем призов' }
    }
    return { valid: true }
  },

  selectWinners(participants, prizes) {
    const available = [...participants]
    const selections: WinnerSelection[] = []

    // Sort prizes by order (smallest first for prototype)
    const sortedPrizes = [...prizes].sort((a, b) => a.sortOrder - b.sortOrder)

    for (const prize of sortedPrizes) {
      const randomIndex = Math.floor(Math.random() * available.length)
      const winner = available.splice(randomIndex, 1)[0]

      selections.push({
        prizeId: prize.id,
        participantId: winner.id,
      })
    }

    return selections
  },
}
```

## Example: Name Reveal Visualization

```typescript
// src/plugins/visualizations/name-reveal.tsx
import { motion } from 'framer-motion'
import type { WinnerVisualization, VisualizationProps } from '@/types'

function NameRevealComponent({ winner, onComplete }: VisualizationProps) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center min-h-[300px]"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      onAnimationComplete={onComplete}
    >
      <motion.div
        className="text-2xl text-muted mb-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {winner.prize}
      </motion.div>
      
      <motion.div
        className="text-5xl font-bold text-accent"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.5 }}
      >
        {winner.name}
      </motion.div>
    </motion.div>
  )
}

export const nameReveal: WinnerVisualization = {
  id: 'name-reveal',
  name: 'Эффектное появление',
  description: 'Имя победителя появляется с анимацией',
  duration: 2000,
  Component: NameRevealComponent,
}
```

## Registering Plugins

```typescript
// src/plugins/index.ts
import { pluginRegistry } from './registry'

// Games
import { classicLottery } from './games/classic'

// Visualizations
import { nameReveal } from './visualizations/name-reveal'

// Themes
import { newYearTheme } from './themes/new-year'

// Register all plugins
pluginRegistry.registerGame(classicLottery)
pluginRegistry.registerVisualization(nameReveal)
pluginRegistry.registerTheme(newYearTheme)

export { pluginRegistry }
```

## Using Plugins

```typescript
// In components
import { pluginRegistry } from '@/plugins'

function DrawingController({ settings }: { settings: RoomSettings }) {
  const game = pluginRegistry.getGame(settings.gameType)
  const visualization = pluginRegistry.getVisualization(settings.visualization)
  
  if (!game || !visualization) {
    return <Error message="Invalid configuration" />
  }
  
  const startDrawing = () => {
    const result = game.canStart(participants, prizes)
    if (!result.valid) {
      showError(result.error)
      return
    }
    
    const winners = game.selectWinners(participants, prizes)
    // Animate using visualization.Component
  }
}
```

## Adding New Plugins

1. Create implementation file in appropriate directory
2. Implement the interface completely
3. Register in `src/plugins/index.ts`
4. Add to settings options if user-selectable
