import { AppTheme } from '@/types'

const themes = new Map<string, AppTheme>()

export function registerTheme(theme: AppTheme) {
  themes.set(theme.id, theme)
}

export function getTheme(id: string): AppTheme | undefined {
  return themes.get(id)
}

export function getAllThemes(): AppTheme[] {
  return Array.from(themes.values())
}

export function applyTheme(themeId: string) {
  const theme = getTheme(themeId)
  if (!theme) return

  const root = document.documentElement
  root.className = `theme-${themeId}`
}

// Auto-import themes (will be populated later)
// import { newYearTheme } from './new-year'
// registerTheme(newYearTheme)
