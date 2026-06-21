import { useEffect, useState } from 'react'
import {
  fetchWorkspaces,
  fetchModerationItems,
  resolveModerationItem,
  ModerationItem,
  WorkspaceItem,
} from './services/moderationApi'

export const ModerationPanel: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')
  const [queue, setQueue] = useState<ModerationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Session KPI stats
  const [approvedToday, setApprovedToday] = useState(0)
  const [rejectedToday, setRejectedToday] = useState(0)

  // 1. Load workspaces
  useEffect(() => {
    let active = true
    const loadWorkspaces = async () => {
      try {
        const items = await fetchWorkspaces()
        if (active && items.length > 0) {
          setWorkspaces(items)
          // Set first workspace as default
          setSelectedWorkspaceId(items[0].id)
        } else if (active) {
          setSelectedWorkspaceId('1')
        }
      } catch (err) {
        console.error('Failed to load workspaces:', err)
        if (active) {
          setSelectedWorkspaceId('1')
        }
      }
    }
    void loadWorkspaces()
    return () => {
      active = false
    }
  }, [])

  // 2. Load moderation items for selected workspace
  const loadQueue = async (wsId: string) => {
    if (!wsId) return
    try {
      setLoading(true)
      // Check status pending_approval
      const items = await fetchModerationItems(wsId, 'pending_approval')
      setQueue(items)
      setError(null)
    } catch (err: any) {
      console.error('Failed to load moderation items:', err)
      setError(err.message || 'Failed to fetch moderation queue from agent-api.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedWorkspaceId) {
      void loadQueue(selectedWorkspaceId)
    }
  }, [selectedWorkspaceId])

  // 3. Resolve item
  const handleResolve = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await resolveModerationItem(id, selectedWorkspaceId, decision)
      
      // Update local UI state
      setQueue((prev) => prev.filter((item) => item.id !== id))
      if (decision === 'approve') {
        setApprovedToday((prev) => prev + 1)
      } else {
        setRejectedToday((prev) => prev + 1)
      }
    } catch (err: any) {
      console.error('Failed to resolve item:', err)
      alert(`Action failed: ${err.message || 'Unknown error'}`)
    }
  }

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return isoString
    }
  }

  return (
    <div className="admin-content">
      {/* Workspace Selector & Top Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0' }}>
            Concierge Moderation Queue
          </h2>
          <p style={{ color: 'var(--admin-text-muted)', margin: 0 }}>
            Audit captured links and documents flagged by security filters.
          </p>
        </div>

        {workspaces.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--admin-text-muted)' }}>
              Active Workspace:
            </span>
            <select
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid var(--admin-border-soft)',
                backgroundColor: 'var(--admin-card-bg)',
                color: 'var(--admin-text-ink)',
                fontSize: '14px',
                fontWeight: 500,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} (ID: {ws.id})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* KPI Stats Row */}
      <div className="admin-kpi-row">
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Pending Approval</div>
          <div className="admin-kpi-val">{loading ? '...' : queue.length}</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Approved (Session)</div>
          <div className="admin-kpi-val" style={{ color: '#137333' }}>{approvedToday}</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Rejected (Session)</div>
          <div className="admin-kpi-val" style={{ color: '#c5221f' }}>{rejectedToday}</div>
        </div>
      </div>

      {/* Main Queue List */}
      <div>
        {loading && (
          <div style={{ padding: '64px', textAlign: 'center', color: 'var(--admin-text-muted)' }}>
            Fetching moderation items...
          </div>
        )}

        {error && (
          <div style={{ padding: '24px', backgroundColor: '#FEF2F2', border: '1px solid #FEE2E2', borderRadius: '8px', color: '#B91C1C', marginBottom: '24px' }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && queue.length === 0 && (
          <div className="admin-empty-state">
            <div className="admin-empty-icon">🛡️</div>
            <div className="admin-empty-title">All Clear!</div>
            <div className="admin-empty-desc">
              No items currently pending approval for this workspace. All captures are successfully processed.
            </div>
          </div>
        )}

        {!loading && queue.length > 0 && (
          <div className="admin-queue-list">
            {queue.map((item) => (
              <div className="admin-item-card" key={item.id}>
                {/* Card Meta Header */}
                <div className="admin-item-meta">
                  <div className="admin-item-source-group">
                    <span className="admin-source-label">{item.source || 'Capture'}</span>
                    <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)', fontFamily: 'monospace' }}>
                      ID: {item.id}
                    </span>
                  </div>
                  <span className="admin-item-date">{formatDate(item.createdAt)}</span>
                </div>

                {/* Content Details */}
                <div>
                  <h3 className="admin-item-title">{item.title || 'Untitled Capture'}</h3>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="admin-item-url">
                      {item.url}
                    </a>
                  )}
                </div>

                {/* Redacted Content Preview */}
                <div className="admin-redacted-box">
                  {item.redactedText || 'No text content available.'}
                </div>

                {/* Badges / Category flags */}
                <div className="admin-badge-container">
                  {item.promptInjection && (
                    <span className="admin-badge injection">⚠️ Prompt Injection Alert</span>
                  )}
                  {item.redactedCategories && item.redactedCategories.map((cat) => (
                    <span className="admin-badge pii" key={cat}>
                      🔒 PII: {cat}
                    </span>
                  ))}
                  {(!item.promptInjection && (!item.redactedCategories || item.redactedCategories.length === 0)) && (
                    <span className="admin-badge" style={{ backgroundColor: '#F3F4F6', color: '#374151' }}>
                      ⚙️ Flagged for Review
                    </span>
                  )}
                </div>

                {/* Approve / Reject Actions */}
                <div className="admin-actions">
                  <button className="admin-btn approve" onClick={() => handleResolve(item.id, 'approve')}>
                    ✓ Approve Capture
                  </button>
                  <button className="admin-btn reject" onClick={() => handleResolve(item.id, 'reject')}>
                    ✗ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
