import type { SearchItem, NoteItem } from './types'

const DB_NAME = 'KeeptLocalVault'
const DB_VERSION = 1

export interface LocalBookmark extends SearchItem {
  embedding?: number[]
}

export interface LocalNote extends NoteItem {
  embedding?: number[]
}

export function initLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('bookmarks')) {
        db.createObjectStore('bookmarks', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' })
      }
    }
  })
}

export async function saveLocalBookmark(bookmark: LocalBookmark): Promise<void> {
  const db = await initLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bookmarks', 'readwrite')
    const store = tx.objectStore('bookmarks')
    const request = store.put(bookmark)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(tx.error)
  })
}

export async function saveLocalNote(note: LocalNote): Promise<void> {
  const db = await initLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite')
    const store = tx.objectStore('notes')
    const request = store.put(note)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(tx.error)
  })
}

export async function listLocalBookmarks(): Promise<LocalBookmark[]> {
  const db = await initLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bookmarks', 'readonly')
    const store = tx.objectStore('bookmarks')
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(tx.error)
  })
}

export async function listLocalNotes(): Promise<LocalNote[]> {
  const db = await initLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readonly')
    const store = tx.objectStore('notes')
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(tx.error)
  })
}

export async function deleteLocalBookmark(id: string): Promise<void> {
  const db = await initLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bookmarks', 'readwrite')
    const store = tx.objectStore('bookmarks')
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(tx.error)
  })
}

export async function deleteLocalNote(id: string): Promise<void> {
  const db = await initLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite')
    const store = tx.objectStore('notes')
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(tx.error)
  })
}

export async function clearLocalVault(): Promise<void> {
  const db = await initLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['bookmarks', 'notes'], 'readwrite')
    tx.objectStore('bookmarks').clear()
    tx.objectStore('notes').clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function getLocalEmbeddingFromGemini(text: string, apiKey: string): Promise<number[]> {
  const cleanKey = apiKey.trim()
  if (!cleanKey) throw new Error('Gemini API key is required for local embedding')
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${cleanKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: {
        parts: [{ text }]
      }
    })
  })
  
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini embedding failed: ${response.status} - ${errText}`)
  }
  
  const data = await response.json()
  const embedding = data.embedding?.values
  if (!Array.isArray(embedding)) {
    throw new Error('Invalid embedding response format from Gemini')
  }
  return embedding
}

export async function searchLocalVault(input: {
  query: string
  sourceFilter: 'All' | 'Obsidian' | 'Bookmarks' | 'Links'
  apiKey?: string
  limit?: number
}): Promise<SearchItem[]> {
  const trimmed = input.query.trim().toLowerCase()
  const limit = input.limit || 20
  if (!trimmed) {
    const bookmarks = await listLocalBookmarks()
    const notes = await listLocalNotes()
    
    const searchNotes: SearchItem[] = notes.map(n => ({
      id: n.id,
      source: 'Obsidian',
      title: n.title,
      snippet: n.content.slice(0, 300),
      link: n.link,
      tags: n.tags,
      relevance: 1.0,
      createdAt: n.updatedAt
    }))
    
    const combined = [...bookmarks, ...searchNotes]
    return combined
      .filter(item => input.sourceFilter === 'All' || item.source === input.sourceFilter)
      .slice(0, limit)
  }

  let queryEmbedding: number[] | null = null
  if (input.apiKey && navigator.onLine) {
    try {
      queryEmbedding = await getLocalEmbeddingFromGemini(input.query, input.apiKey)
    } catch (err) {
      console.warn('Local embedding generation failed, falling back to text search:', err)
    }
  }

  const bookmarks = await listLocalBookmarks()
  const notes = await listLocalNotes()
  
  const searchNotes: SearchItem[] = notes.map(n => ({
    id: n.id,
    source: 'Obsidian',
    title: n.title,
    snippet: n.content.slice(0, 300),
    link: n.link,
    tags: n.tags,
    relevance: 0,
    createdAt: n.updatedAt,
    embedding: (n as any).embedding
  }))

  const combined = [...bookmarks, ...searchNotes]
  const filtered = combined.filter(item => input.sourceFilter === 'All' || item.source === input.sourceFilter)

  let scored: Array<SearchItem & { score: number }> = []

  if (queryEmbedding) {
    scored = filtered.map(item => {
      const itemEmbedding = (item as any).embedding
      let score = 0
      if (Array.isArray(itemEmbedding) && itemEmbedding.length > 0) {
        score = cosineSimilarity(queryEmbedding!, itemEmbedding)
      } else {
        const hitTitle = item.title.toLowerCase().includes(trimmed)
        const hitSnippet = item.snippet.toLowerCase().includes(trimmed)
        const hitTag = item.tags.some(t => t.toLowerCase().includes(trimmed))
        if (hitTitle) score = 0.45
        else if (hitSnippet) score = 0.25
        else if (hitTag) score = 0.20
      }
      return { ...item, score }
    })
    scored.sort((a, b) => b.score - a.score)
  } else {
    scored = filtered.map(item => {
      const hitTitle = item.title.toLowerCase().includes(trimmed)
      const hitSnippet = item.snippet.toLowerCase().includes(trimmed)
      const hitTag = item.tags.some(t => t.toLowerCase().includes(trimmed))
      let score = 0
      if (hitTitle) score += 0.6
      if (hitSnippet) score += 0.3
      if (hitTag) score += 0.1
      return { ...item, score }
    }).filter(item => item.score > 0)
    scored.sort((a, b) => b.score - a.score)
  }

  return scored.map(item => ({
    id: item.id,
    source: item.source,
    title: item.title,
    snippet: item.snippet,
    link: item.link,
    tags: item.tags,
    relevance: Math.max(0, Math.min(1.0, item.score)),
    createdAt: item.createdAt
  })).slice(0, limit)
}

export async function exportLocalVaultToJson(): Promise<string> {
  const bookmarks = await listLocalBookmarks()
  const notes = await listLocalNotes()
  const payload = {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarks,
    notes
  }
  return JSON.stringify(payload, null, 2)
}

export async function importLocalVaultFromJson(jsonString: string): Promise<{ bookmarksLoaded: number, notesLoaded: number }> {
  const payload = JSON.parse(jsonString)
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup file format')
  }
  
  const bookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : []
  const notes = Array.isArray(payload.notes) ? payload.notes : []
  
  await clearLocalVault()
  
  for (const b of bookmarks) {
    await saveLocalBookmark(b)
  }
  for (const n of notes) {
    await saveLocalNote(n)
  }
  
  return {
    bookmarksLoaded: bookmarks.length,
    notesLoaded: notes.length
  }
}
