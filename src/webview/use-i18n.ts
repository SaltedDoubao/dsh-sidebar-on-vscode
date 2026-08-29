import { useCallback } from 'react'
import { useAppStore } from './store'
import { translate, type Locale, type TranslationKey, type TranslationValues } from './i18n'

export interface I18nApi {
  locale: Locale
  t: (key: TranslationKey, values?: TranslationValues) => string
}

export function useI18n(): I18nApi {
  const locale = useAppStore((state) => state.uiPrefs.language)
  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values),
    [locale],
  )
  return { locale, t }
}
