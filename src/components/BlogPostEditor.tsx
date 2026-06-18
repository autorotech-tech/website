/**
 * Blog Post Editor Component
 * Enhanced editor with image upload, SEO generation, and translation
 */

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Save, Globe, Image as ImageIcon, X, CheckCircle, AlertCircle, Plus, Upload, Sparkles, Wand2, Loader2, Languages, ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BlogPostGenerator } from './BlogPostGenerator'

const BLOG_API_URL = '/api/blog'

const SUPPORTED_LANGUAGES = ['en', 'ru', 'es', 'it', 'fr', 'vi', 'kz'] as const
type Locale = typeof SUPPORTED_LANGUAGES[number]

function setAuthCookie(token: string) {
  document.cookie = `sb - access - token=${token}; Domain =.autoro.tech; Path =/; Secure; SameSite=None; Max-Age=3600`
}

interface BlogPostEditorProps {
  postId?: string
  onClose: () => void
  onSave: () => void
}

interface Translation {
  language: Locale
  title: string
  content: string
  excerpt: string
  meta_title: string
  meta_description: string
}

export function BlogPostEditor({ postId, onClose, onSave }: BlogPostEditorProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [generatingAudio, setGeneratingAudio] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [slug, setSlug] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [featuredImageUrl, setFeaturedImageUrl] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [translations, setTranslations] = useState<Translation[]>([])
  const [activeLang, setActiveLang] = useState<Locale>('en')
  const [selectedLanguages, setSelectedLanguages] = useState<Locale[]>(SUPPORTED_LANGUAGES.filter(l => l !== 'en'))
  const [model, _setModel] = useState<'gemini' | 'glm'>('gemini')
  const [tagsInput, setTagsInput] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  // const turnstileLoadedRef = useRef(false)
  const [seoScore, _setSeoScore] = useState(0)
  const [seoSuggestions, _setSeoSuggestions] = useState<string[]>([])
  const [showGenerator, setShowGenerator] = useState(false)

  const audioInputRef = useRef<HTMLInputElement>(null)

  const handleApplyGeneratedPost = (data: {
    title: string
    content: string
    excerpt: string
    meta_title: string
    meta_description: string
    featured_image_url?: string
    seo_keywords?: string[] // Assuming we might add this
  }) => {
    // Default logic: update content for active lang (or 'en')
    const lang = activeLang
    const newTranslations = translations.map(t => {
      if (t.language === lang) {
        return {
          ...t,
          title: data.title || t.title,
          content: data.content || t.content,
          excerpt: data.excerpt || t.excerpt,
          meta_title: data.meta_title || t.meta_title,
          meta_description: data.meta_description || t.meta_description,
        }
      }
      return t
    })
    setTranslations(newTranslations)

    if (data.featured_image_url) {
      setFeaturedImageUrl(data.featured_image_url)
    }
  }

  // Initialize translations for all languages
  const getInitialTranslations = (): Translation[] => {
    return SUPPORTED_LANGUAGES.map(lang => ({
      language: lang,
      title: '',
      content: '',
      excerpt: '',
      meta_title: '',
      meta_description: '',
    }))
  }

  // Initialize translations on mount
  useEffect(() => {
    if (translations.length === 0) {
      setTranslations(getInitialTranslations())
    }
  }, [])

  // Listen for generated post content
  useEffect(() => {
    const handleGeneratedPost = (event: CustomEvent) => {
      const generatedContent = event.detail
      if (generatedContent && !postId) {
        // Only apply generated content when creating new post (not editing)
        // Set featured image if available
        if (generatedContent.featured_image_url) {
          setFeaturedImageUrl(generatedContent.featured_image_url)
        }

        // Set slug from title
        if (generatedContent.title && !slug) {
          const slugFromTitle = generatedContent.title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 100)
          setSlug(slugFromTitle)
        }

        // Update English translation with generated content
        setTranslations(prev => {
          const updated = prev.map(t => {
            if (t.language === 'en') {
              return {
                ...t,
                title: generatedContent.title || t.title,
                content: generatedContent.content || t.content,
                excerpt: generatedContent.excerpt || t.excerpt,
                meta_title: generatedContent.meta_title || t.meta_title,
                meta_description: generatedContent.meta_description || t.meta_description,
              }
            }
            return t
          })
          return updated
        })

        // Set active language to English if content was generated in English
        setActiveLang('en')
      }
    }

    window.addEventListener('blog-post-generated', handleGeneratedPost as EventListener)
    return () => {
      window.removeEventListener('blog-post-generated', handleGeneratedPost as EventListener)
    }
  }, [postId, slug])

  useEffect(() => {
    if (postId) {
      loadPost()
    }
  }, [postId])

  const loadPost = async () => {
    try {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const url = `${BLOG_API_URL}/admin/posts/${postId}`
      console.log('Loading post from:', url)
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to load post')
      }

      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch (e) {
        console.error('Failed to parse response as JSON:', text)
        throw new Error(`Server returned invalid JSON: ${text.substring(0, 100)}...`)
      }
      const post = data.post

      setSlug(post.slug || '')
      setStatus(post.status || 'draft')
      setFeaturedImageUrl(post.featured_image_url || '')
      setAudioUrl((post as any).audio_url || '')
      // Initialize tags from seo_keywords (if present)
      if (Array.isArray(post.seo_keywords) && post.seo_keywords.length > 0) {
        setTagsInput(post.seo_keywords.join(', '))
      }

      // Load translations for all languages
      const loadedTranslations: Translation[] = SUPPORTED_LANGUAGES.map(lang => {
        const trans = post.blog_post_translations?.find((t: any) => t.language === lang)
        return {
          language: lang,
          title: trans?.title || '',
          content: trans?.content || '',
          excerpt: trans?.excerpt || '',
          meta_title: trans?.meta_title || '',
          meta_description: trans?.meta_description || '',
        }
      })

      setTranslations(loadedTranslations)

      // Set active lang to first available translation or 'en'
      const firstWithContent = loadedTranslations.find(t => t.title || t.content)
      if (firstWithContent) {
        setActiveLang(firstWithContent.language)
      }
    } catch (error: any) {
      console.error('Error loading post:', error)
      alert(`Error loading post: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleUploadImage = async (file: File, isContentImage: boolean = false) => {
    try {
      setUploading(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      // Set cookie for hybrid auth
      if (session.access_token) {
        setAuthCookie(session.access_token)
      }

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }

      const data = await response.json()

      if (isContentImage) {
        // Insert image markdown into content at cursor position
        const currentTranslation = translations.find(t => t.language === activeLang)
        if (currentTranslation) {
          const textarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement
          if (textarea) {
            const start = textarea.selectionStart
            const end = textarea.selectionEnd
            const imageMarkdown = `![${file.name}](${data.url})`
            const newContent =
              currentTranslation.content.substring(0, start) +
              imageMarkdown +
              currentTranslation.content.substring(end)

            updateTranslation(activeLang, 'content', newContent)

            // Set cursor position after inserted image
            setTimeout(() => {
              textarea.focus()
              textarea.setSelectionRange(start + imageMarkdown.length, start + imageMarkdown.length)
            }, 0)
          }
        }
      } else {
        // Set as featured image AND auto-insert into content after 2nd paragraph
        setFeaturedImageUrl(data.url)

        // Auto-insert logic
        const currentTranslation = translations.find(t => t.language === activeLang)
        if (currentTranslation && currentTranslation.content) {
          const paragraphs = currentTranslation.content.split('\n\n')
          if (paragraphs.length >= 2) {
            // Insert after 2nd paragraph
            const imageMarkdown = `\n\n![Featured Image](${data.url})\n\n`
            const newContent = paragraphs.slice(0, 2).join('\n\n') + imageMarkdown + paragraphs.slice(2).join('\n\n')
            updateTranslation(activeLang, 'content', newContent)
          } else {
            // Append if less than 2 paragraphs
            const imageMarkdown = `\n\n![Featured Image](${data.url})`
            updateTranslation(activeLang, 'content', currentTranslation.content + imageMarkdown)
          }
        }
      }

      return data.url
    } catch (error: any) {
      console.error('Upload error:', error)
      alert(`Upload failed: ${error.message}`)
      throw error
    } finally {
      setUploading(false)
    }
  }

  const handleUploadAudio = async (file: File) => {
    if (!file) return

    try {
      setUploading(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error('Not authenticated')
      }

      // Set cookie for hybrid auth
      setAuthCookie(session.access_token)

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }

      const data = await response.json()
      setAudioUrl(data.url)
      alert('Audio uploaded successfully!')
      return data.url
    } catch (error: any) {
      console.error('Audio upload error:', error)
      alert(`Upload failed: ${error.message}`)
      throw error
    } finally {
      setUploading(false)
    }
  }

  const handleGenerateSEO = async () => {
    const currentTranslation = translations.find(t => t.language === activeLang)
    if (!currentTranslation?.content.trim()) {
      alert('Please enter content first')
      return
    }

    try {
      setGenerating(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${BLOG_API_URL}/admin/generate-seo`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: currentTranslation.content,
          language: activeLang,
          title: currentTranslation.title,
          model,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Generation failed')
      }

      const data = await response.json()

      // Update current translation with generated data
      updateTranslation(activeLang, 'title', data.title || currentTranslation.title)
      updateTranslation(activeLang, 'excerpt', data.excerpt || '')
      updateTranslation(activeLang, 'meta_title', data.meta_title || '')
      updateTranslation(activeLang, 'meta_description', data.meta_description || '')

      // Update tags if provided
      if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
        setTagsInput(data.tags.join(', '))
      }

      // Auto-generate slug if empty
      if (!slug.trim() && data.slug) {
        setSlug(data.slug)
      }
    } catch (error: any) {
      console.error('SEO generation error:', error)
      alert(`Failed to generate SEO: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateImage = async () => {
    const currentTranslationData = translations.find(t => t.language === activeLang)
    if (!currentTranslationData?.title) {
      alert('Please enter a title first')
      return
    }

    try {
      setGeneratingImage(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${BLOG_API_URL}/admin/generate-image`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: currentTranslationData.title,
          description: currentTranslationData.excerpt || currentTranslationData.content.substring(0, 200),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate image')
      }

      const data = await response.json()
      if (data.image_url) {
        setFeaturedImageUrl(data.image_url)
        alert('Image generated successfully!')
      }
    } catch (error: any) {
      console.error('Image generation error:', error)
      alert(`Failed to generate image: ${error.message}`)
    } finally {
      setGeneratingImage(false)
    }
  }

  const handleOptimizeContent = async () => {
    const currentTranslation = translations.find(t => t.language === activeLang)
    if (!currentTranslation?.content.trim()) {
      alert('Please enter content first')
      return
    }

    if (!confirm('This will optimize the current content. Continue?')) {
      return
    }

    try {
      setOptimizing(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${BLOG_API_URL}/admin/optimize-content`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: currentTranslation.content,
          language: activeLang,
          model,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Optimization failed')
      }

      const data = await response.json()

      // Update content with optimized version
      updateTranslation(activeLang, 'content', data.optimized_content)
      alert('Content optimized successfully!')
    } catch (error: any) {
      console.error('Content optimization error:', error)
      alert(`Failed to optimize content: ${error.message}`)
    } finally {
      setOptimizing(false)
    }
  }

  const handleGenerateAudio = async () => {
    const currentTranslationData = translations.find(t => t.language === activeLang)
    if (!currentTranslationData?.content.trim()) {
      alert('Please enter content first')
      return
    }

    try {
      setGeneratingAudio(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${BLOG_API_URL}/admin/generate-audio`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: currentTranslationData.title,
          content: currentTranslationData.content,
          language: activeLang,
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to generate audio')
      }

      const data = await response.json()
      if (data.url) {
        setAudioUrl(data.url)
        alert('Deep Dive audio generated successfully!')
      }
    } catch (error: any) {
      console.error('Audio generation error:', error)
      alert(`Failed to generate audio: ${error.message}`)
    } finally {
      setGeneratingAudio(false)
    }
  }

  const handleTranslate = async () => {
    const currentTranslation = translations.find(t => t.language === activeLang)
    if (!currentTranslation?.title.trim() || !currentTranslation?.content.trim()) {
      alert('Please fill in title and content before translating')
      return
    }

    // Determine which languages to translate to
    const targetLangs: Locale[] =
      selectedLanguages.length > 0
        ? selectedLanguages.filter((l) => l !== activeLang)
        : SUPPORTED_LANGUAGES.filter((l) => l !== activeLang)

    if (targetLangs.length === 0) {
      alert('Please select at least one target language for translation')
      return
    }

    if (
      !confirm(
        `This will translate the post from ${activeLang.toUpperCase()} into ${targetLangs
          .map((l) => l.toUpperCase())
          .join(', ')}.\nTranslations will be requested sequentially. Continue?`
      )
    ) {
      return
    }

    try {
      setTranslating(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const allTranslations: any[] = []

      // Sequentially translate for each selected language to better handle rate limits
      for (const lang of targetLangs) {
        const response = await fetch(`${BLOG_API_URL}/admin/translate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: currentTranslation.title,
            content: currentTranslation.content,
            excerpt: currentTranslation.excerpt,
            meta_title: currentTranslation.meta_title,
            meta_description: currentTranslation.meta_description,
            sourceLanguage: activeLang,
            targetLanguages: [lang],
          }),
        })

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Translation failed' }))
          console.error(`Translation request failed for ${lang}:`, error.error)
          continue
        }

        const data = await response.json()
        console.log(`Translation response for ${lang}:`, data)

        if (Array.isArray(data.translations) && data.translations.length > 0) {
          allTranslations.push(data.translations[0])
        }
      }

      if (allTranslations.length === 0) {
        throw new Error('No translations were produced')
      }

      // Update translations state using collected per-language results
      setTranslations(prev =>
        prev.map(t => {
          if (t.language === activeLang) {
            return t
          }

          const translated = allTranslations.find((tr: any) => tr.language === t.language)
          if (translated) {
            if (translated.error) {
              console.warn(`Translation error for ${t.language}:`, translated.error)
              return t
            }
            if (translated.title || translated.content) {
              return {
                ...t,
                title: translated.title || t.title,
                content: translated.content || t.content,
                excerpt: translated.excerpt || t.excerpt || '',
                meta_title: translated.meta_title || t.meta_title || '',
                meta_description: translated.meta_description || t.meta_description || '',
              }
            }
          }
          return t
        })
      )
      alert('Translation completed!')
    } catch (error: any) {
      console.error('Translation error:', error)
      alert(`Translation failed: ${error.message}`)
    } finally {
      setTranslating(false)
    }
  }

  const handleDeleteFile = async (url: string, type: 'image' | 'audio') => {
    if (!url) return
    if (!confirm('Are you sure you want to delete this file from the server? This cannot be undone.')) return

    try {
      setUploading(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      // Extract bucket and path from URL
      let bucket = ''
      let path = ''

      // Handle Supabase Storage URLs
      if (url.includes('/blog-images/')) {
        bucket = 'blog-images'
        path = url.split('/blog-images/')[1]
      } else if (url.includes('/blog-audio/')) {
        bucket = 'blog-audio'
        path = url.split('/blog-audio/')[1]
      } else if (url.includes('/blog-media/')) {
        bucket = 'blog-media'
        path = url.split('/blog-media/')[1]
      }

      // If we extracted a bucket and path, try to delete from server
      if (bucket && path) {
        const response = await fetch(`${BLOG_API_URL}/admin/upload`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ bucket, path }),
        })

        if (!response.ok) {
          const error = await response.json()
          console.error('Failed to delete file from server:', error)
          // We continue to clear local state even if server delete fails (e.g. 404)
        }
      }

      if (type === 'image') setFeaturedImageUrl('')
      if (type === 'audio') setAudioUrl('')

    } catch (error: any) {
      console.error('Delete error:', error)
      alert(`Error deleting file: ${error.message}`)
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!slug.trim()) {
      alert('Please enter a slug')
      return
    }

    // Check if at least one translation has title and content
    const hasValidTranslation = translations.some(
      t => t.title.trim() && t.content.trim()
    )

    if (!hasValidTranslation) {
      alert('Please fill in at least one translation with title and content')
      return
    }

    // Turnstile check disabled
    // if (!turnstileToken) {
    //   alert('Please complete the Turnstile check before saving the post.')
    //   return
    // }

    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      // Parse tags from input (comma-separated)
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      // Filter out empty translations and format
      const validTranslations = translations
        .filter(t => t.title.trim() && t.content.trim())
        .map(t => ({
          language: t.language,
          title: t.title,
          content: t.content,
          excerpt: t.excerpt || undefined,
          meta_title: t.meta_title || undefined,
          meta_description: t.meta_description || undefined,
        }))

      const payload = {
        slug: slug.trim(),
        status,
        featured_image_url: featuredImageUrl || undefined,
        audio_url: audioUrl || undefined,
        seo_keywords: tags.length > 0 ? tags : undefined,
        translations: validTranslations,
      }

      const url = postId ? `${BLOG_API_URL}/admin/posts/${postId}` : `${BLOG_API_URL}/admin/posts`
      const method = postId ? 'PUT' : 'POST'

      // Ensure we have a valid access token
      if (!session.access_token || typeof session.access_token !== 'string' || session.access_token.trim().length === 0) {
        throw new Error('Invalid access token. Please log in again.')
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${session.access_token.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || 'Failed to save post' }
        }
        throw new Error(errorData.error || 'Failed to save post')
      }

      alert('Post saved successfully!')
      onSave()
      // onClose() - Keep editor open after save
    } catch (error: any) {
      console.error('Error saving post:', error)
      alert(`Error saving post: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const updateTranslation = (lang: Locale, field: keyof Translation, value: string) => {
    setTranslations(prev =>
      prev.map(t =>
        t.language === lang ? { ...t, [field]: value } : t
      )
    )
  }

  // Ensure translations are always available
  const currentTranslations = translations.length > 0 ? translations : getInitialTranslations()
  const currentTranslation = currentTranslations.find(t => t.language === activeLang) || currentTranslations[0]
  const canTranslate = currentTranslation?.title.trim() && currentTranslation?.content.trim()
  const canGenerate = currentTranslation?.content.trim()

  // Only show loading overlay when editing existing post
  if (loading && postId) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[95vh] flex flex-col my-4">
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </button>
            <h2 className="text-xl font-bold">
              {postId ? 'Edit Post' : 'New Post'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGenerator(true)}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Generate Blog Post
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 border rounded hover:bg-gray-50 flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {showGenerator && (
          <BlogPostGenerator
            onClose={() => setShowGenerator(false)}
            onCreatePost={handleApplyGeneratedPost}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto p-6 space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Slug *</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="my-awesome-post"
                />
                <p className="text-xs text-gray-500 mt-1">Auto-generated from title when using Generate SEO</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>

            {/* Featured Image */}
            <div>
              <label className="block text-sm font-medium mb-1">Featured Image</label>
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleUploadImage(file, false)
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-4 py-2 border rounded hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading...' : 'Upload Image'}
                </button>
                <button
                  onClick={handleGenerateImage}
                  disabled={generatingImage || !translations.find(t => t.language === activeLang)?.title}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2 disabled:opacity-50"
                >
                  {generatingImage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Generate Image
                </button>
                {featuredImageUrl && (
                  <div className="flex items-center gap-2">
                    <img src={featuredImageUrl} alt="Featured" className="h-16 w-16 object-cover rounded" />
                    <button
                      onClick={() => handleDeleteFile(featuredImageUrl, 'image')}
                      className="text-red-600 hover:text-red-800"
                      title="Delete image from server"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {featuredImageUrl && (
                  <input
                    type="url"
                    value={featuredImageUrl}
                    onChange={(e) => setFeaturedImageUrl(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded min-w-[200px]"
                    placeholder="Or paste image URL"
                  />
                )}
              </div>
            </div>

            {/* Audio File */}
            <div>
              <label className="block text-sm font-medium mb-1">Audio File (MP3, M4A, etc.)</label>
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,.m4a"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleUploadAudio(file)
                  }}
                />
                <button
                  onClick={() => audioInputRef.current?.click()}
                  disabled={uploading}
                  className="px-4 py-2 border rounded hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading...' : 'Upload Audio'}
                </button>
                {audioUrl && (
                  <>
                    <audio controls src={audioUrl} className="max-w-md" />
                    <button
                      onClick={() => handleDeleteFile(audioUrl, 'audio')}
                      className="text-red-600 hover:text-red-800"
                      title="Delete audio from server"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
                {audioUrl && (
                  <input
                    type="url"
                    value={audioUrl}
                    onChange={(e) => setAudioUrl(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded min-w-[200px]"
                    placeholder="Or paste audio URL"
                  />
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Audio version will be displayed between excerpt and content. Supported: MP3, M4A, AAC, WAV, OGG
              </p>
            </div>

            {/* Turnstile (bot protection for publishing) - Disabled
            <div>
              <label className="block text-sm font-medium mb-1">Bot Protection</label>
              <p className="text-xs text-gray-500 mb-2">
                Please complete the Cloudflare Turnstile check before saving/publishing.
              </p>
              <div
                className="cf-turnstile"
                data-sitekey="0x4AAAAAACIU4Ousfobn41c1"
                data-callback="onTurnstileBlog"
              />
            </div>
            */}

            {/* Language Tabs */}
            <div>
              <div className="flex gap-2 border-b overflow-x-auto">
                {currentTranslations.map((t) => {
                  const hasContent = t.title || t.content
                  return (
                    <button
                      key={t.language}
                      onClick={() => setActiveLang(t.language)}
                      className={`px-4 py-2 border-b-2 whitespace-nowrap flex items-center gap-2 ${activeLang === t.language
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-800'
                        }`}
                    >
                      {t.language.toUpperCase()}
                      {hasContent && <span className="text-xs">●</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleGenerateSEO}
                disabled={!canGenerate || generating}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Generate SEO
              </button>
              <button
                onClick={handleOptimizeContent}
                disabled={!canGenerate || optimizing}
                className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {optimizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                Optimize Content
              </button>
              <button
                onClick={handleGenerateAudio}
                disabled={!canGenerate || generatingAudio}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generatingAudio ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Deep Dive Audio
              </button>
              <button
                onClick={handleTranslate}
                disabled={!canTranslate || translating}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {translating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Languages className="w-4 h-4" />
                )}
                Translate
              </button>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-600">Target languages:</span>
                {SUPPORTED_LANGUAGES.filter((lang) => lang !== activeLang).map((lang) => (
                  <label key={lang} className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selectedLanguages.includes(lang)}
                      onChange={() =>
                        setSelectedLanguages((prev) =>
                          prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
                        )
                      }
                    />
                    <span className="uppercase">{lang}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Translation Editor */}
            <div className="space-y-4">
              {/* Tags for SEO */}
              <div>
                <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="seo, automation, ai, marketing"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Used for SEO and internal categorization. Separate tags with commas.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Title *</label>
                <input
                  type="text"
                  value={currentTranslation.title}
                  onChange={(e) => updateTranslation(activeLang, 'title', e.target.value)}
                  className="w-full px-3 py-2 border rounded text-lg font-medium mb-4"
                  placeholder="Enter post title"
                />

              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  {/* Main Content Column */}
                  <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold">Content</h2>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowPreview(!showPreview)}
                          className={`px-3 py-1 text-sm border rounded ${showPreview ? 'bg-blue-50 border-blue-200 text-blue-700' : 'hover:bg-gray-50'}`}
                        >
                          {showPreview ? 'Edit' : 'Preview'}
                        </button>
                      </div>
                    </div>

                    {showPreview ? (
                      <div className="prose max-w-none border p-4 rounded min-h-[400px]">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            img: (props: any) => <img {...props} className="max-w-full h-auto rounded" />
                          }}
                        >
                          {currentTranslation.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <>
                        {/* Editor Toolbar */}
                        <div className="flex flex-wrap gap-2 mb-2 p-2 bg-gray-50 rounded border">
                          <button
                            onClick={() => {
                              const textarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement
                              if (!textarea) return
                              const start = textarea.selectionStart
                              const end = textarea.selectionEnd
                              const text = textarea.value
                              const newContent = text.substring(0, start) + '**Bold**' + text.substring(end)
                              updateTranslation(activeLang, 'content', newContent)
                            }}
                            className="p-1 hover:bg-gray-200 rounded text-sm font-bold w-6 h-6 flex items-center justify-center"
                            title="Bold"
                          >
                            B
                          </button>
                          <button
                            onClick={() => {
                              const textarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement
                              if (!textarea) return
                              const start = textarea.selectionStart
                              const end = textarea.selectionEnd
                              const text = textarea.value
                              const newContent = text.substring(0, start) + '*Italic*' + text.substring(end)
                              updateTranslation(activeLang, 'content', newContent)
                            }}
                            className="p-1 hover:bg-gray-200 rounded text-sm italic w-6 h-6 flex items-center justify-center"
                            title="Italic"
                          >
                            I
                          </button>
                          <div className="w-px bg-gray-300 mx-1"></div>
                          {/* Add more toolbar items as needed */}
                        </div>

                        <textarea
                          value={currentTranslation.content}
                          onChange={(e) => updateTranslation(activeLang, 'content', e.target.value)}
                          className="w-full px-3 py-2 border rounded font-mono text-sm min-h-[400px]"
                          placeholder="Write your post content in Markdown..."
                        />
                      </>
                    )}
                  </div>

                  {/* SEO Fields */}
                  <div>
                    {/* SEO Fields */}
                    <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
                      <details className="group">
                        <summary className="cursor-pointer font-medium list-none flex items-center justify-between text-gray-700">
                          <span>SEO Metadata (Optional)</span>
                          <Plus className="w-4 h-4 transition-transform group-open:rotate-45" />
                        </summary>
                        <div className="mt-4 space-y-4 pt-4 border-t">
                          <div>
                            <label className="block text-sm font-medium mb-1">Meta Title</label>
                            <input
                              type="text"
                              value={currentTranslation.meta_title || ''}
                              onChange={(e) => updateTranslation(activeLang, 'meta_title', e.target.value)}
                              className="w-full px-3 py-2 border rounded"
                              placeholder="SEO optimized title (50-60 characters)"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium mb-1">Meta Description</label>
                            <textarea
                              value={currentTranslation.meta_description || ''}
                              onChange={(e) => updateTranslation(activeLang, 'meta_description', e.target.value)}
                              className="w-full px-3 py-2 border rounded"
                              rows={3}
                              placeholder="Description for search engines (150-160 characters)"
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Sidebar Column */}

                  {/* SEO Score Card */}
                  <div className="bg-white p-6 rounded-lg shadow-sm border">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        <span className="text-xl">📊</span> SEO Analysis
                      </h3>
                      <div className={`text-xl font-bold ${seoScore >= 80 ? 'text-green-600' : seoScore >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {seoScore}/100
                      </div>
                    </div>

                    <div className="w-px bg-gray-300 mx-1"></div>
                    <button
                      type="button"
                      onClick={() => {
                        const url = prompt('Enter YouTube or Vimeo URL:')
                        if (!url) return

                        // Simple check for YouTube/Vimeo
                        let embedCode = ''
                        if (url.includes('youtube.com') || url.includes('youtu.be')) {
                          const videoId = url.includes('v=') ? url.split('v=')[1].split('&')[0] : url.split('/').pop()
                          embedCode = `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
                        } else if (url.includes('vimeo.com')) {
                          const videoId = url.split('/').pop()
                          embedCode = `<iframe src="https://player.vimeo.com/video/${videoId}" width="100%" height="400" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
                        } else {
                          embedCode = `[video](${url})`
                        }

                        const textarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement
                        if (!textarea) return

                        const start = textarea.selectionStart
                        const end = textarea.selectionEnd
                        const text = textarea.value
                        const before = text.substring(0, start)
                        const after = text.substring(end)

                        const newContent = `${before}\n${embedCode}\n${after}`
                        updateTranslation(activeLang, 'content', newContent)
                      }}
                      className="px-2 py-1 text-xs border rounded hover:bg-white flex items-center gap-1"
                      title="Embed Video (YouTube/Vimeo)"
                    >
                      <span className="text-xs">🎥</span> Video
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const textarea = document.querySelector('textarea[placeholder*="Markdown"]') as HTMLTextAreaElement
                        if (!textarea) return
                        const start = textarea.selectionStart
                        const end = textarea.selectionEnd
                        const text = textarea.value
                        const before = text.substring(0, start)
                        const after = text.substring(end)
                        const newContent = `${before} {{city}} ${after}`
                        updateTranslation(activeLang, 'content', newContent)
                        setTimeout(() => {
                          textarea.focus()
                          textarea.setSelectionRange(start + 9, start + 9)
                        }, 0)
                      }}
                      className="px-2 py-1 text-xs border rounded hover:bg-white flex items-center gap-1 font-mono text-blue-600"
                      title="Insert Dynamic City Placeholder"
                    >
                      <Globe className="w-3 h-3" />
                      {"{{city}}"}
                    </button>
                    <div className="w-px bg-gray-300 mx-1"></div>
                    <div className="space-y-2">
                      {seoSuggestions.length === 0 ? (
                        <div className="text-sm text-green-600 flex items-center gap-1">
                          <CheckCircle className="w-4 h-4" /> Great job! Content looks optimized.
                        </div>
                      ) : (
                        seoSuggestions.map((suggestion, idx) => (
                          <div key={idx} className="text-sm text-red-600 flex items-start gap-2 bg-red-50 p-2 rounded">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            {suggestion}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Publishing Options */}
                  <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
                    <h3 className="font-medium text-gray-900">Publishing</h3>

                    <div>
                      <label className="block text-sm font-medium mb-1">Slug</label>
                      <input
                        type="text"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        className="w-full px-3 py-2 border rounded bg-gray-50"
                        placeholder="post-url-slug"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Featured Image</label>
                      {featuredImageUrl ? (
                        <div className="relative aspect-video rounded-lg overflow-hidden border bg-gray-100 group">
                          <img src={featuredImageUrl} alt="Featured" className="w-full h-full object-cover" />
                          <button
                            onClick={() => handleDeleteFile(featuredImageUrl, 'image')}
                            className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div
                          onClick={() => imageInputRef.current?.click()}
                          className="aspect-video border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors"
                        >
                          <ImageIcon className="w-8 h-8 text-gray-400 mb-2" />
                          <span className="text-sm text-gray-500">Click to upload cover</span>
                        </div>
                      )}
                    </div>

                    <div className="pt-4 border-t flex flex-col gap-3">
                      <button
                        onClick={handleSave}
                        disabled={uploading}
                        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        {uploading ? 'Saving...' : 'Save Post'}
                      </button>
                      {status === 'published' && (
                        <a
                          href={`https://autoro.tech/blog/${slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="w-full py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2"
                        >
                          <Globe className="w-4 h-4" />
                          View Live
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
