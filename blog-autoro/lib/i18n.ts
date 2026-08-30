export const LOCALES = ['en', 'ru', 'es', 'it', 'fr', 'vi', 'kz'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
  es: 'Español',
  it: 'Italiano',
  fr: 'Français',
  vi: 'Tiếng Việt',
  kz: 'Қазақша',
}

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale)
}
