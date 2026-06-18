import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LogOut, Settings, Menu, X, BarChart3, MessageSquareText, FileText, Share2, Search, Cog, Zap, ExternalLink, Link2, PanelsTopLeft, Bookmark, NotebookPen, Globe2 } from 'lucide-react'

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authLoaded, setAuthLoaded] = useState(false)

  const deerflowUrl = (import.meta as any).env?.VITE_DEERFLOW_URL || 'http://46.250.228.229:2026'

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      setUserEmail(session.user.email || 'User')

      const { data } = await supabase
        .from('profiles')
        .select('role, is_blocked')
        .eq('id', session.user.id)
        .single()

      if (data?.is_blocked) {
        await supabase.auth.signOut()
        alert('Your account has been blocked. Please contact support.')
        navigate('/login')
        return
      }

      if (data?.role === 'admin') setIsAdmin(true)
      setAuthLoaded(true)
    }
    checkUser()
  }, [navigate])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const services = isAdmin
    ? []
    : [
      { icon: BarChart3, label: 'Marketing Audit', path: '/' }, // Default to tasks
      { icon: MessageSquareText, label: 'Chat Agent', path: '/chat-agent' },
      { icon: NotebookPen, label: 'Assistant Memory', path: '/assistant-memory' },
    ]

  const adminItems = [
    { icon: BarChart3, label: 'Marketing Audit', path: '/admin/marketing-audit' },
    { icon: MessageSquareText, label: 'Chat Agent', path: '/admin/chat-agent' },
    { icon: NotebookPen, label: 'Assistant Memory', path: '/assistant-memory' },
    { icon: FileText, label: 'Blog', path: '/admin/blog' },
    { icon: Share2, label: 'Social Crossposting', path: '/admin/social-crossposting' },
    { icon: Search, label: 'Web Scraping', path: '/admin/web-scraping' },
    { icon: Zap, label: 'Deep Search', path: '/admin/deep-search' },
    { icon: Globe2, label: 'Expired Domains', path: '/admin/expired-domains' },
    { icon: Link2, label: 'Ad Spots', path: '/admin/spots' },
    { icon: PanelsTopLeft, label: 'Landings', path: '/admin/landings' },
    { icon: Bookmark, label: 'Bookmarks Bro', path: '/admin/bookmarks-bro' },
    { icon: ExternalLink, label: 'DeerFlow (Research)', externalUrl: deerflowUrl },
    { icon: Search, label: 'Perplexica AI', path: '/admin/perplexica' },
    { icon: Cog, label: 'Settings', path: '/admin/settings' },
  ]

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-20'} bg-slate-900 text-white transition-all duration-300 flex flex-col`}>
        <div className="p-4 flex items-center justify-between border-b border-slate-700">
          {isSidebarOpen && <span className="font-bold text-xl">Autoro</span>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-1 hover:bg-slate-700 rounded">
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {!authLoaded ? (
            <div className="space-y-3 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center p-3 rounded">
                  <div className="w-5 h-5 bg-slate-700 rounded" />
                  {isSidebarOpen && <div className="ml-3 h-4 bg-slate-700 rounded w-28" />}
                </div>
              ))}
            </div>
          ) : isAdmin ? (
            <>
              {isSidebarOpen && (
                <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Administration</div>
              )}
              {adminItems.map((item) => (
                'externalUrl' in item ? (
                  <a
                    key={item.label}
                    href={(item as any).externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center w-full p-3 rounded transition-colors hover:bg-slate-800 text-red-300"
                    title="Open DeerFlow in new tab"
                  >
                    <item.icon size={20} />
                    {isSidebarOpen && <span className="ml-3">{item.label}</span>}
                  </a>
                ) : (
                  <button
                    key={(item as any).path}
                    onClick={() => navigate((item as any).path)}
                    className={`flex items-center w-full p-3 rounded transition-colors ${location.pathname === (item as any).path ? 'bg-red-900 text-white' : 'hover:bg-slate-800 text-red-300'
                      }`}
                  >
                    <item.icon size={20} />
                    {isSidebarOpen && <span className="ml-3">{item.label}</span>}
                  </button>
                )
              ))}
            </>
          ) : (
            <>
              {isSidebarOpen && (
                <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Services</div>
              )}
              {services.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex items-center w-full p-3 rounded transition-colors ${location.pathname === item.path ||
                      (item.path === '/' && location.pathname.startsWith('/task/'))
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-slate-800 text-gray-300'
                    }`}
                >
                  <item.icon size={20} />
                  {isSidebarOpen && <span className="ml-3">{item.label}</span>}
                </button>
              ))}
              {isSidebarOpen && (
                <div className="mt-6 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">General</div>
              )}
              <button
                onClick={() => navigate('/settings')}
                className={`flex items-center w-full p-3 rounded transition-colors ${location.pathname === '/settings'
                    ? 'bg-slate-800 text-white'
                    : 'hover:bg-slate-800 text-gray-300'
                  }`}
              >
                <Settings size={20} />
                {isSidebarOpen && <span className="ml-3">Settings</span>}
              </button>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center mb-4 overflow-hidden">
            {isSidebarOpen && <span className="text-sm text-gray-400 truncate">{userEmail}</span>}
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center w-full p-2 text-red-400 hover:bg-slate-800 rounded transition-colors"
          >
            <LogOut size={20} />
            {isSidebarOpen && <span className="ml-3">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
