import { useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { ModerationPanel } from './ModerationPanel'
import { SettingsPanel } from './SettingsPanel'
import './styles/admin.css'

const BOOTSTRAP_TOKEN_KEY = 'bookmarks_bro_bootstrap_token'

export function KeeptAdminApp() {
  const navigate = useNavigate()
  const token = localStorage.getItem(BOOTSTRAP_TOKEN_KEY)?.trim()

  useEffect(() => {
    if (!token) {
      // Redirect to login if no active session
      navigate('/login')
    }
  }, [token, navigate])

  if (!token) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAF8F5', color: '#1F1A15', fontFamily: 'sans-serif' }}>
        Redirecting to login...
      </div>
    )
  }

  return (
    <div className="admin-layout">
      {/* Sidebar Navigation */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-logo">
          <span>🛡️</span> Keept <span>Admin</span>
        </div>
        
        <nav className="admin-nav">
          <NavLink
            to="/keept/admin"
            end
            className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
          >
            🛡️ Moderation Queue
          </NavLink>
          <NavLink
            to="/keept/admin/settings"
            className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
          >
            ⚙️ Swoop Models
          </NavLink>
        </nav>

        <div className="admin-sidebar-footer">
          <NavLink to="/bookmarks-bro" className="admin-nav-item">
            ← Back to Library
          </NavLink>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-header-title">Content Moderation Console</div>
          <div className="admin-workspace-badge">Owner Access</div>
        </header>

        <Routes>
          <Route path="/" element={<ModerationPanel />} />
          <Route path="/settings" element={<SettingsPanel />} />
        </Routes>
      </main>
    </div>
  )
}
