/**
 * Blog Admin Panel Component
 * Integrates blog management into existing admin panel on swoop.autoro.tech
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FileText, Plus, Edit, Trash2, Eye, ExternalLink, Settings, Sparkles } from 'lucide-react'
import { BlogPostEditor } from './BlogPostEditor'
import { BlogSettings } from './BlogSettings'
import { BlogPostGenerator } from './BlogPostGenerator'

// Blog API URL - блог работает на порту 3002, проксируется через Nginx
// Используем абсолютный URL к API блога
const BLOG_API_URL = '/api/blog'

interface BlogPost {
  id: string
  slug: string
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
  published_at: string | null
  view_count: number
  blog_post_translations?: Array<{
    id: string
    language: string
    title: string
    excerpt: string | null
  }>
}

export function BlogAdmin() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published'>('all')
  const [page, _setPage] = useState(1)
  const [_totalPages, setTotalPages] = useState(1)
  const [editingPostId, setEditingPostId] = useState<string | undefined>(undefined)
  const [showEditor, setShowEditor] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showGenerator, setShowGenerator] = useState(false)

  const fetchPosts = async () => {
    try {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
      })

      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }

      const response = await fetch(`${BLOG_API_URL}/admin/posts?${params}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Blog API not found. Please ensure the blog system is deployed.')
        }
        if (response.status === 401) {
          throw new Error('Blog API unauthorized. Please sign in again.')
        }
        throw new Error(`Failed to fetch posts: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      setPosts(data.posts || [])
      setTotalPages(data.pagination?.totalPages || 1)
    } catch (error: any) {
      console.error('Error fetching posts:', error)
      // Show user-friendly error message
      if (error.message.includes('Blog API not found')) {
        alert('Blog system is not yet deployed. Please contact the administrator.')
      } else if (error.message.includes('Blog API unauthorized')) {
        alert('Session expired or invalid. Please sign out and sign in again.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPosts()
  }, [page, statusFilter])

  const handleDelete = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post?')) {
      return
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${BLOG_API_URL}/admin/posts/${postId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to delete post')
      }

      fetchPosts()
    } catch (error) {
      console.error('Error deleting post:', error)
      alert('Failed to delete post')
    }
  }

  const handleRequestIndex = async (postId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${BLOG_API_URL}/admin/posts/${postId}/index`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to request indexing')
      }

      alert('Indexing requested successfully')
    } catch (error) {
      console.error('Error requesting indexing:', error)
      alert('Failed to request indexing')
    }
  }

  const filteredPosts = posts.filter(post => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      return post.slug.toLowerCase().includes(searchLower) ||
        post.blog_post_translations?.some(t =>
          t.title.toLowerCase().includes(searchLower)
        )
    }
    return true
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-red-400" />
            <span>Blog Posts</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage articles, AI generation and SEO for Autoro Blog.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 flex items-center gap-2 text-sm"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={() => setShowGenerator(true)}
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 flex items-center gap-2 text-sm"
          >
            <Sparkles className="w-4 h-4" />
            Generate Post
          </button>
          <button
            onClick={() => {
              setEditingPostId(undefined)
              setShowEditor(true)
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            New Post
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search posts by title or slug..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border rounded-md bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-4 py-2 border rounded-md bg-white w-full md:w-48"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </div>

      {/* Posts Grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No posts found</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredPosts.map((post) => {
            const translation = post.blog_post_translations?.[0]
            const title = translation?.title || post.slug
            const excerpt = translation?.excerpt || ''
            const isPublished = post.status === 'published'

            return (
              <div
                key={post.id}
                className="relative flex flex-col rounded-xl border bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      isPublished
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {post.status}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(post.created_at).toLocaleDateString()}
                  </span>
                </div>

                <div className="px-4 pb-3">
                  <h2 className="text-base font-semibold text-gray-900 line-clamp-2">
                    {title}
                  </h2>
                  {excerpt && (
                    <p className="mt-1 text-sm text-gray-500 line-clamp-3">
                      {excerpt}
                    </p>
                  )}
                </div>

                <div className="mt-auto px-4 pb-3 flex items-center justify-between text-xs text-gray-500">
                  <span className="truncate max-w-[60%]">
                    /en/blog/<span className="font-mono">{post.slug}</span>
                  </span>
                  <span>{post.view_count} views</span>
                </div>

                <div className="border-t px-3 py-2 flex items-center justify-between gap-2 bg-gray-50">
                  <div className="flex items-center gap-1">
                    {isPublished && (
                      <>
                        <button
                          onClick={() => window.open(`https://autoro.tech/en/blog/${post.slug}`, '_blank')}
                          className="p-1.5 rounded hover:bg-blue-100 text-blue-600"
                          title="View on site"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRequestIndex(post.id)}
                          className="p-1.5 rounded hover:bg-purple-100 text-purple-600"
                          title="Request indexing"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingPostId(post.id)
                        setShowEditor(true)
                      }}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                      title="Edit post"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(post.id)}
                      className="p-1.5 rounded hover:bg-red-100 text-red-600"
                      title="Delete post"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Post Editor Modal */}
      {showEditor && (
        <BlogPostEditor
          postId={editingPostId}
          onClose={() => {
            setShowEditor(false)
            setEditingPostId(undefined)
          }}
          onSave={() => {
            fetchPosts()
            setShowEditor(false)
            setEditingPostId(undefined)
          }}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[95vh] flex flex-col my-4">
            <div className="border-b p-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold">Blog Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <BlogSettings />
            </div>
          </div>
        </div>
      )}

      {/* Post Generator Modal */}
      {showGenerator && (
        <BlogPostGenerator
          onClose={() => setShowGenerator(false)}
          onCreatePost={(generatedContent) => {
            // Open editor with generated content
            setShowGenerator(false)
            setEditingPostId(undefined)
            setShowEditor(true)
            // Dispatch event to pass generated content to editor
            setTimeout(() => {
              const event = new CustomEvent('blog-post-generated', { detail: generatedContent })
              window.dispatchEvent(event)
            }, 100)
          }}
        />
      )}
    </div>
  )
}

