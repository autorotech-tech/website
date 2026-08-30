import { LOCALES, isLocale } from '@/lib/i18n'

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const lang = isLocale(params.locale) ? params.locale : 'en'
  return (
    <div lang={lang} data-locales={LOCALES.join(',')}>
      {children}
    </div>
  )
}
