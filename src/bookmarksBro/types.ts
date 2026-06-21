export type SourceKind = 'Obsidian' | 'Bookmarks' | 'Links'

export interface SearchItem {
  id: string
  source: SourceKind
  title: string
  snippet: string
  link?: string
  tags: string[]
  category?: string
  relevance: number
  createdAt?: string
}

export interface IdeaItem {
  id: string
  title: string
  context: string
  originRefs: string[]
  priority: 'low' | 'medium' | 'high'
  remindAt?: string
  status: 'draft' | 'active' | 'done'
  createdAt: string
}

export interface ReminderItem {
  id: string
  ideaId: string
  title: string
  remindAt: string
  done: boolean
}

export interface KnowledgeItem {
  id: string
  title: string
  summary: string
  tags: string[]
  refs: string[]
  status: 'draft' | 'reviewed' | 'published'
  createdAt: string
}

export interface NoteItem {
  id: string
  title: string
  content: string
  source: 'Obsidian' | 'Knowledge'
  tags: string[]
  updatedAt: string
  link?: string
}

export interface TaskTokenUsage {
  id: string
  taskName: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  updatedAt: string
}

export interface KnowledgeExportBundle {
  workspaceId: string
  query: string
  mode: 'semantic' | 'text'
  generatedAt: string
  itemCount: number
  vectorCount: number
  markdown: string
  items: Array<{
    knowledgeItemId: number
    title: string
    url?: string
    summary?: string
    category?: string
    tags: string[]
    notePath?: string
    status?: string
    distance?: number | null
    embeddingModel?: string | null
  }>
}

export type AgentContext = 'kb' | 'hybrid' | 'web'
export type AgentDepth = 'quick' | 'deep'
export type AgentAutonomy = 'answer' | 'suggest' | 'act'

export interface AgentAction {
  id?: string
  type: 'create_task' | 'create_knowledge' | 'create_reminder' | 'modify_tags'
  title?: string
  description?: string
  bookmarkId?: number
  tags?: string[]
  minutesDelay?: number
  reason?: string
  executed?: boolean
}

export type StorageMode = 'cloud' | 'local'

