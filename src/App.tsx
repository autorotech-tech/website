import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Login } from './components/Login'
import { TaskList } from './components/TaskList'
import { TaskDetail } from './components/TaskDetail'
import { AdminPanel } from './components/AdminPanel'
import { ChatAgents } from './components/ChatAgents'
import { AdminChatAgents } from './components/AdminChatAgents'
import { BlogAdmin } from './components/BlogAdmin'
import { CatalogAdmin } from './components/CatalogAdmin'
import { SocialCrossposting } from './components/SocialCrossposting'
import { AdminScrapling } from './components/AdminScrapling'
import { AdminPerplexica } from './components/AdminPerplexica'
import { AdminExpiredDomains } from './components/AdminExpiredDomains'
import { AdminDeepSearch } from './components/AdminDeepSearch'
import { AdminSettings } from './components/AdminSettings'
import { AdminSpots } from './components/AdminSpots'
import { AdminLandings } from './components/AdminLandings'
import { AdminBookmarksBro } from './components/AdminBookmarksBro'
import { AssistantMemory } from './components/AssistantMemory'
import { BookmarksBroApp } from './bookmarksBro/BookmarksBroApp'
import { KeeptAdminApp } from './keeptAdmin/KeeptAdminApp'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/keept/admin/*" element={<KeeptAdminApp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<TaskList />} />
          <Route path="task/:id" element={<TaskDetail />} />
          <Route path="upload" element={<Navigate to="/" replace />} />
          <Route path="admin" element={<Navigate to="/admin/marketing-audit" replace />} />
          <Route path="admin/marketing-audit" element={<AdminPanel />} />
          <Route path="admin/chat-agent" element={<AdminChatAgents />} />
          <Route path="admin/blog" element={<BlogAdmin />} />
          <Route path="admin/pquoc-catalog" element={<CatalogAdmin />} />
          <Route path="admin/social-crossposting" element={<SocialCrossposting />} />
          <Route path="admin/web-scraping" element={<AdminScrapling />} />
          <Route path="admin/deep-search" element={<AdminDeepSearch />} />
          <Route path="admin/spots" element={<AdminSpots />} />
          <Route path="admin/landings" element={<AdminLandings />} />
          <Route path="admin/bookmarks-bro" element={<AdminBookmarksBro />} />
          <Route path="admin/perplexica" element={<AdminPerplexica />} />
          <Route path="admin/expired-domains" element={<AdminExpiredDomains />} />
          <Route path="admin/settings" element={<AdminSettings />} />
          <Route path="chat-agent" element={<ChatAgents />} />
          <Route path="assistant-memory" element={<AssistantMemory />} />
          <Route path="bookmarks-bro" element={<BookmarksBroApp />} />
          <Route path="settings" element={<div className="p-4">Settings Component Coming Soon</div>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
