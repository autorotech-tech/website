/**
 * Social Crossposting — план разработки и будущий интерфейс
 * Post once, publish everywhere. Unified API + адаптация контента и медиа.
 */
import { Share2, Circle, ExternalLink } from 'lucide-react'

export function SocialCrossposting() {
  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-blue-100 rounded-lg">
          <Share2 className="w-8 h-8 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Social Crossposting</h1>
          <p className="text-gray-600">Post once. Publish everywhere. Unified API + адаптация контента и медиа.</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Workflow */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Target Workflow</h2>
          <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm text-gray-700">
            [Генерация статьи в блоге] → [AI подготавливает контент для соцсетей] → [Выбор платформ] → [Одна кнопка: Post]
          </div>
        </section>

        {/* Architecture */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Архитектура: Unified API</h2>
          <p className="text-gray-600 mb-4">
            Используем провайдера (Postproxy, Late) для абстракции разных API платформ. Адаптируем посты и медиа под каждую платформу.
          </p>
          <ul className="space-y-2 text-gray-700">
            <li>• <strong>Контент:</strong> AI адаптирует текст под лимиты (X: 280, Threads: 500, Instagram: 2200...)</li>
            <li>• <strong>Медиа:</strong> ресайз, формат, EXIF — автоматически под требования платформы</li>
          </ul>
        </section>

        {/* Phases */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">План по фазам</h2>
          <div className="space-y-4">
            <PhaseItem
              phase="Фаза 0"
              title="Подготовка (1–2 нед)"
              items={[
                'Выбор провайдера Unified API (Postproxy / Late)',
                'Регистрация приложений в соцсетях',
                'Схема БД: social_accounts, social_posts, social_schedules',
              ]}
            />
            <PhaseItem
              phase="Фаза 1"
              title="MVP — Share to Social (3–4 нед)"
              items={[
                'OAuth подключение аккаунтов (X, LinkedIn, Facebook)',
                'AI-подготовка вариантов из статьи блога',
                'Публикация через Unified API',
                'EXIF: автоматическое добавление метаданных к медиа',
              ]}
            />
            <PhaseItem
              phase="Фаза 2"
              title="Расширение (2–3 нед)"
              items={[
                'Планирование постов (scheduled_at)',
                '5–7 платформ',
                'Статусы публикаций (success/failed)',
              ]}
            />
            <PhaseItem
              phase="Фаза 3"
              title="Продвинутые функции (4+ нед)"
              items={[
                'Workflows: авто-пост при публикации статьи',
                'Аналитика: просмотры, лайки',
                'Карусели, видео (Shorts, Reels, TikTok)',
              ]}
            />
          </div>
        </section>

        {/* EXIF */}
        <section className="bg-amber-50 rounded-xl border border-amber-200 p-6">
          <h2 className="text-lg font-semibold text-amber-900 mb-2">EXIF для медиа</h2>
          <p className="text-amber-800 text-sm mb-3">
            Функция автоматического добавления EXIF к файлам перед публикацией:
          </p>
          <ul className="text-amber-800 text-sm space-y-1">
            <li>• Copyright, Artist — бренд/автор</li>
            <li>• GPS (опционально) — для геолокации</li>
            <li>• Размеры под требования платформы (Instagram, LinkedIn и т.д.)</li>
          </ul>
        </section>

        {/* Links */}
        <section className="flex flex-wrap gap-3">
          <a
            href="https://postproxy.dev/blog/cross-posting-to-multiple-social-networks-via-api/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700"
          >
            Postproxy Guide <ExternalLink className="w-4 h-4" />
          </a>
          <a
            href="https://socialaize.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700"
          >
            Socialaize <ExternalLink className="w-4 h-4" />
          </a>
        </section>
      </div>
    </div>
  )
}

function PhaseItem({
  phase,
  title,
  items,
}: {
  phase: string
  title: string
  items: string[]
}) {
  return (
    <div className="border-l-2 border-blue-200 pl-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-blue-600 uppercase">{phase}</span>
        <span className="text-gray-900 font-medium">{title}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
            <Circle className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
