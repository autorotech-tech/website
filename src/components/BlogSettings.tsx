/**
 * Blog Settings Component
 * Manage blog settings including AI prompts for SEO and content optimization
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Save, Loader2, Key } from 'lucide-react'

const BLOG_API_URL = '/api/blog'

export function BlogSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      if (!session.access_token || typeof session.access_token !== 'string' || session.access_token.trim().length === 0) {
        throw new Error('Invalid access token. Please log in again.')
      }

      const response = await fetch(`${BLOG_API_URL}/admin/settings`, {
        headers: {
          'Authorization': `Bearer ${session.access_token.trim()}`,
        },
      })

      if (!response.ok) {
        // 404 на этом эндпоинте трактуем как "настроек ещё нет" без всплывающей ошибки
        if (response.status === 404) {
          console.warn('Blog settings not found, using empty defaults.')
          setSettings({})
          return
        }

        const errorText = await response.text()
        console.error('Settings API error:', response.status, errorText)

        // Try to parse as JSON for better error message
        let errorMessage = `Failed to load settings: ${response.status} ${response.statusText}`
        try {
          const errorJson = JSON.parse(errorText)
          if (errorJson.error) {
            errorMessage = errorJson.error
          }
        } catch (e) {
          // Not JSON, use text as is
          if (errorText && !errorText.includes('<!DOCTYPE')) {
            errorMessage = errorText.substring(0, 200)
          }
        }

        throw new Error(errorMessage)
      }

      const data = await response.json()
      // Handle both array format and object format
      if (Array.isArray(data)) {
        const settingsMap: Record<string, string> = {}
        data.forEach((item: any) => {
          settingsMap[item.key] = item.value
        })
        setSettings(settingsMap)
      } else if (data.settings) {
        setSettings(data.settings)
      } else {
        setSettings(data)
      }
    } catch (error: any) {
      console.error('Error loading settings:', error)
      const message = String(error?.message || '')
      // Не спамим алертом для 404 (обработан выше) и мягких сетевых ошибок
      if (!message.includes('Failed to load settings: 404')) {
        alert(`Error loading settings: ${message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      if (!session.access_token || typeof session.access_token !== 'string' || session.access_token.trim().length === 0) {
        throw new Error('Invalid access token. Please log in again.')
      }

      // Ensure all values are strings (not null/undefined) to satisfy database constraints
      const sanitizedSettings: Record<string, string> = {}
      Object.entries(settings).forEach(([key, value]) => {
        sanitizedSettings[key] = value === null || value === undefined ? '' : String(value)
      })

      const response = await fetch(`${BLOG_API_URL}/admin/settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session.access_token.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sanitizedSettings),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save settings')
      }

      alert('Settings saved successfully!')
    } catch (error: any) {
      console.error('Error saving settings:', error)
      alert(`Error saving settings: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const updateSetting = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="space-y-6">
        {/* Provider API Keys */}
        <details className="border rounded-lg p-4" open>
          <summary className="cursor-pointer font-semibold text-lg flex items-center gap-2 mb-4">
            <Key className="w-5 h-5 text-gray-500" />
            Provider API Keys
          </summary>
          <div className="mt-4 space-y-6">
            <div>
              <label className="block text-sm font-medium mb-1">
                Gemini API Keys (for generation & audio)
              </label>
              <textarea
                value={settings.gemini_api_key || ''}
                onChange={(e) => updateSetting('gemini_api_key', e.target.value)}
                placeholder={"AIzaSy...\nAIzaSy... (one key per line)"}
                className="w-full px-3 py-2 border rounded font-mono text-sm bg-white dark:bg-dark-800 min-h-[72px]"
              />
              <p className="text-xs text-gray-500 mt-1">
                One key per line. Multiple keys будут использоваться по очереди / как список.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                OpenAI / ChatGPT API Keys (optional)
              </label>
              <textarea
                value={settings.openai_api_key || ''}
                onChange={(e) => updateSetting('openai_api_key', e.target.value)}
                placeholder={"sk-...\nsk-... (one key per line)"}
                className="w-full px-3 py-2 border rounded font-mono text-sm bg-white dark:bg-dark-800 min-h-[72px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                GLM API Keys (BigModel)
              </label>
              <textarea
                value={settings.glm_api_key || ''}
                onChange={(e) => updateSetting('glm_api_key', e.target.value)}
                placeholder={"sk-...\nsk-... (one key per line)"}
                className="w-full px-3 py-2 border rounded font-mono text-sm bg-white dark:bg-dark-800 min-h-[72px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Groq API Keys
              </label>
              <textarea
                value={settings.groq_api_key || ''}
                onChange={(e) => updateSetting('groq_api_key', e.target.value)}
                placeholder={"gsk_...\ngsk_... (one key per line)"}
                className="w-full px-3 py-2 border rounded font-mono text-sm bg-white dark:bg-dark-800 min-h-[72px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                OpenRouter API Key (for Deep Search)
              </label>
              <textarea
                value={settings.openrouter_api_key || ''}
                onChange={(e) => updateSetting('openrouter_api_key', e.target.value)}
                placeholder={"sk-or-v1-...\nsk-or-v1-... (one key per line)"}
                className="w-full px-3 py-2 border rounded font-mono text-sm bg-white dark:bg-dark-800 min-h-[72px]"
              />
              <p className="text-xs text-gray-500 mt-1">
                Used by Deep Search to access 100+ LLMs via <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className="underline">openrouter.ai</a>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Brave Search API Key (for Deep Search)
              </label>
              <input
                type="password"
                value={settings.brave_api_key || ''}
                onChange={(e) => updateSetting('brave_api_key', e.target.value)}
                placeholder="BSAe5Q..."
                className="w-full px-3 py-2 border rounded font-mono text-sm bg-white dark:bg-dark-800"
              />
            </div>
            <p className="text-xs text-gray-500">
              These keys are used securely by the backend to generate posts, translations, images and audio.
            </p>
          </div>
        </details>

        {/* SEO Generation Prompts */}
        <details className="border rounded-lg p-4" open>
          <summary className="cursor-pointer font-semibold text-lg mb-4">
            SEO Generation Prompts
          </summary>
          <div className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Main SEO Generation Prompt
              </label>
              <textarea
                value={settings.seo_generation_prompt || ''}
                onChange={(e) => updateSetting('seo_generation_prompt', e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                rows={12}
                placeholder="Prompt for generating SEO metadata..."
              />
              <p className="text-xs text-gray-500 mt-1">
                Use {'{language}'} for language and {'{content}'} for content placeholders
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Title Generation Prompt
              </label>
              <textarea
                value={settings.title_generation_prompt || ''}
                onChange={(e) => updateSetting('title_generation_prompt', e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                rows={4}
                placeholder="Prompt for generating title..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Excerpt Generation Prompt
              </label>
              <textarea
                value={settings.excerpt_generation_prompt || ''}
                onChange={(e) => updateSetting('excerpt_generation_prompt', e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                rows={4}
                placeholder="Prompt for generating excerpt..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Meta Title Generation Prompt
              </label>
              <textarea
                value={settings.meta_title_generation_prompt || ''}
                onChange={(e) => updateSetting('meta_title_generation_prompt', e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                rows={4}
                placeholder="Prompt for generating meta title..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Meta Description Generation Prompt
              </label>
              <textarea
                value={settings.meta_description_generation_prompt || ''}
                onChange={(e) => updateSetting('meta_description_generation_prompt', e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                rows={4}
                placeholder="Prompt for generating meta description..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Keywords Generation Prompt
              </label>
              <textarea
                value={settings.keywords_generation_prompt || ''}
                onChange={(e) => updateSetting('keywords_generation_prompt', e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                rows={4}
                placeholder="Prompt for generating keywords..."
              />
            </div>
          </div>
        </details>

        {/* Content Optimization Prompt */}
        <details className="border rounded-lg p-4" open>
          <summary className="cursor-pointer font-semibold text-lg mb-4">
            Content Optimization Prompt
          </summary>
          <div className="mt-4">
            <label className="block text-sm font-medium mb-2">
              Content Optimization Prompt
            </label>
            <textarea
              value={settings.content_optimization_prompt || ''}
              onChange={(e) => updateSetting('content_optimization_prompt', e.target.value)}
              className="w-full px-3 py-2 border rounded font-mono text-sm"
              rows={12}
              placeholder="Prompt for optimizing content..."
            />
            <p className="text-xs text-gray-500 mt-1">
              Use {'{content}'} as placeholder for the content to optimize
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}

