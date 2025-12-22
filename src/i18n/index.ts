import { ru, type Translations } from './ru'

const translations: Record<string, Translations> = {
  ru,
}

let currentLanguage = 'ru'

export function setLanguage(lang: string) {
  if (translations[lang]) {
    currentLanguage = lang
  }
}

export function getLanguage() {
  return currentLanguage
}

export function t(): Translations {
  return translations[currentLanguage]
}

// Hook for use in React components
export function useTranslations() {
  return t()
}
