import { setTranslations } from 'polotno/config'
import editorEn from '../i18n/en.json'

// Seed English defaults synchronously so the editor paints translated from the
// first frame, then overlay the pack matching the OS locale when one exists.
setTranslations(editorEn)

const EDITOR_MESSAGES: Record<string, () => Promise<{ default: unknown }>> = {
  fr: () => import('../i18n/fr.json'),
  id: () => import('../i18n/id.json'),
  'pt-BR': () => import('../i18n/pt-BR.json'),
  ru: () => import('../i18n/ru.json'),
  'zh-CN': () => import('../i18n/zh-CN.json')
}

function matchLocale(language: string): string | null {
  if (EDITOR_MESSAGES[language]) return language
  const base = language.split('-')[0]
  const match = Object.keys(EDITOR_MESSAGES).find((key) => key.split('-')[0] === base)
  return match ?? null
}

export function loadSystemLocaleTranslations(): void {
  const locale = matchLocale(navigator.language)
  if (!locale) return
  EDITOR_MESSAGES[locale]()
    .then((m) => {
      // validate:false — Polotno merges over the English defaults, so any key
      // a pack omits falls back rather than throwing.
      setTranslations(m.default, { validate: false })
    })
    .catch((error) => {
      console.error('[i18n] failed to load editor translations for', locale, error)
    })
}
