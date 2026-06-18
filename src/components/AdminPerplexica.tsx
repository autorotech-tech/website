const DEEP_SEARCH_URL = import.meta.env.VITE_PERPLEXICA_URL || 'https://perplexica.autoro.tech'

export function AdminPerplexica() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Deep Search (AI)</h1>
        <p className="mt-1 text-sm text-gray-500">
          AI-поисковик для глубокого исследования. Если ниже ничего не отображается, откройте по ссылке:&nbsp;
          <a
            href={DEEP_SEARCH_URL}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {DEEP_SEARCH_URL}
          </a>
        </p>
      </div>

      <div className="flex-1 border rounded-lg overflow-hidden bg-gray-50">
        <iframe
          src={DEEP_SEARCH_URL}
          title="Deep Search"
          className="w-full h-full border-0"
        />
      </div>
    </div>
  )
}

