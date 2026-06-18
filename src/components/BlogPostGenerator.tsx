/**
 * Blog Post Generator Component
 * Generate blog posts using AI chat interface with Gemini
 */

import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { X, Send, Sparkles, Image as ImageIcon, Loader2, Check } from 'lucide-react'

const BLOG_API_URL = '/api/blog'

interface BlogPostGeneratorProps {
  onClose: () => void
  onCreatePost: (generatedContent: {
    title: string
    content: string
    excerpt: string
    meta_title: string
    meta_description: string
    featured_image_url?: string
  }) => void
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function BlogPostGenerator({ onClose, onCreatePost }: BlogPostGeneratorProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [model, setModel] = useState<'gemini' | 'glm' | 'groq'>('gemini')
  const [generatedPost, setGeneratedPost] = useState<{
    title: string
    content: string
    excerpt: string
    meta_title: string
    meta_description: string
    featured_image_url?: string
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSend = async () => {
    if (!input.trim() || generating) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setGenerating(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Not authenticated')
      }

      // Build conversation history
      const conversationHistory = [...messages, { role: 'user' as const, content: userMessage }]

      const response = await fetch(`${BLOG_API_URL}/admin/generate-post`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: userMessage,
          conversation: conversationHistory.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
          })),
          model,
        }),
      })

      if (!response.ok) {
        let errorMessage = `Failed to generate post: ${response.status} ${response.statusText}`
        try {
          const errorText = await response.text()
          console.error('API error:', response.status, errorText)

          // Try to parse as JSON
          try {
            const errorJson = JSON.parse(errorText)
            if (errorJson.error) {
              errorMessage = errorJson.error
            }
          } catch (e) {
            // Not JSON, use text if it's not HTML
            if (errorText && !errorText.includes('<!DOCTYPE')) {
              errorMessage = errorText.substring(0, 200)
            }
          }
        } catch (e) {
          console.error('Error reading error response:', e)
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const assistantMessage = data.content || data.text || 'Извините, не удалось сгенерировать ответ.'

      setMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }])

      // If response contains structured post data, save it
      if (data.post) {
        setGeneratedPost(data.post)
        // Show success message
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '✅ Пост успешно сгенерирован! Нажмите "Create Post" для создания.'
        }])
      } else {
        // Try to extract post data from message if it's in JSON format
        try {
          const jsonMatch = assistantMessage.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || assistantMessage.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsedPost = JSON.parse(jsonMatch[1] || jsonMatch[0])
            if (parsedPost.title && parsedPost.content) {
              setGeneratedPost(parsedPost)
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: '✅ Пост успешно сгенерирован! Нажмите "Create Post" для создания.'
              }])
            }
          }
        } catch (e) {
          // Not JSON format, continue conversation
        }
      }
    } catch (error: any) {
      console.error('Generation error:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Ошибка: ${error.message || 'Не удалось сгенерировать пост. Попробуйте еще раз.'}`
      }])
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateImage = async () => {
    if (!generatedPost?.title || generatingImage) return

    setGeneratingImage(true)

    try {
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
          prompt: generatedPost.title,
          description: generatedPost.excerpt || generatedPost.content.substring(0, 200),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate image')
      }

      const data = await response.json()
      if (data.image_url) {
        setGeneratedPost(prev => prev ? { ...prev, featured_image_url: data.image_url } : null)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '✅ Изображение успешно сгенерировано!'
        }])
      }
    } catch (error: any) {
      console.error('Image generation error:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Ошибка генерации изображения: ${error.message || 'Не удалось сгенерировать изображение.'}`
      }])
    } finally {
      setGeneratingImage(false)
    }
  }

  const handleCreatePost = async () => {
    if (generatedPost) {
      try {
        onCreatePost(generatedPost)
        onClose()
      } catch (error: any) {
        console.error('Error creating post:', error)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Ошибка создания поста: ${error.message || 'Не удалось создать пост'}`
        }])
      }
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <h2 className="text-xl font-bold">Generate Blog Post</h2>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">Model:</span>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={model === 'gemini'}
                onChange={() => setModel('gemini')}
              />
              <span>Gemini</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={model === 'glm'}
                onChange={() => setModel('glm')}
              />
              <span>GLM (BigModel)</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={model === 'groq'}
                onChange={() => setModel('groq')}
              />
              <span>Groq</span>
            </label>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              <Sparkles className="w-12 h-12 mx-auto mb-4 text-purple-300" />
              <p className="text-lg font-medium mb-2">Начните генерацию поста</p>
              <p className="text-sm">Опишите тему поста, и я помогу создать контент</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-800 border'
                  }`}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
              </div>
            </div>
          ))}

          {generating && (
            <div className="flex justify-start">
              <div className="bg-white border rounded-lg p-3">
                <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Generated Post Preview */}
        {generatedPost && (
          <div className="border-t bg-purple-50 p-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-green-600" />
                <span className="font-semibold">Post Ready</span>
              </div>
              <button
                onClick={handleGenerateImage}
                disabled={generatingImage}
                className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 flex items-center gap-2 disabled:opacity-50"
              >
                {generatingImage ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImageIcon className="w-4 h-4" />
                )}
                Generate Image
              </button>
            </div>
            <div className="text-sm space-y-1">
              <p><strong>Title:</strong> {generatedPost.title}</p>
              {generatedPost.featured_image_url && (
                <p><strong>Image:</strong> ✅ Generated</p>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t p-4 flex-shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Опишите тему поста или задайте вопрос..."
              className="flex-1 px-4 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              rows={2}
              disabled={generating}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || generating}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
              Send
            </button>
          </div>

          {/* Create Post Button */}
          {generatedPost && (
            <button
              onClick={handleCreatePost}
              className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium"
            >
              <Check className="w-5 h-5" />
              Create Post
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

