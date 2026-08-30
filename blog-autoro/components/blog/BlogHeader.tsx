import Link from 'next/link'
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n'

export function BlogHeader({ locale }: { locale: Locale }) {
  return (
    <header className="border-b border-hairline bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <a href="https://autoro.tech" className="text-lg font-semibold text-ink">
          Autoro
        </a>
        <nav aria-label="Languages">
          <ul className="flex flex-wrap gap-2 text-sm">
            {LOCALES.map((code) => (
              <li key={code}>
                <Link
                  href={`/${code}/blog`}
                  hrefLang={code}
                  className={code === locale ? 'text-brand underline' : 'text-muted hover:text-ink'}
                >
                  {LOCALE_LABELS[code]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}
