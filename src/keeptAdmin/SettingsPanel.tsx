import { useEffect, useState } from 'react'
import { fetchProviderCatalog, ProviderCatalogModel } from './services/moderationApi'

export const SettingsPanel: React.FC = () => {
  const [models, setModels] = useState<ProviderCatalogModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const loadCatalog = async () => {
      try {
        setLoading(true)
        const items = await fetchProviderCatalog()
        if (active) {
          setModels(items)
          setError(null)
        }
      } catch (err: any) {
        console.error('Failed to load Swoop provider catalog:', err)
        if (active) {
          setError(
            err.message ||
              'Unable to fetch Swoop provider catalog. Ensure agent-api is running and keys are active.'
          )
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void loadCatalog()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="admin-content">
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0' }}>
          Infrastructure Settings
        </h2>
        <p style={{ color: 'var(--admin-text-muted)', margin: 0 }}>
          Overview of available LLM models powered by Swoop infrastructure.
        </p>
      </div>

      <div className="admin-kpi-card" style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px 0' }}>
          Concierge RAG Routing
        </h3>
        <p style={{ fontSize: '14px', lineHeight: 1.5, margin: '0 0 16px 0' }}>
          Keept uses intelligent LLM routing managed via the Swoop control plane.
          All content captures are dynamically categorized, summarized, and vectorized
          using pre-configured pipeline models.
        </p>
        <span
          className="admin-source-label"
          style={{ backgroundColor: '#FFF3CD', color: '#856404' }}
        >
          Models powered by Swoop infrastructure
        </span>
      </div>

      <div style={{ backgroundColor: 'var(--admin-card-bg)', borderRadius: '12px', border: '1px solid var(--admin-border-soft)', padding: '24px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>
          Available LLM Catalog
        </h3>

        {loading && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--admin-text-muted)' }}>
            Loading models catalog...
          </div>
        )}

        {error && (
          <div style={{ padding: '24px', backgroundColor: '#FEF2F2', border: '1px solid #FEE2E2', borderRadius: '8px', color: '#B91C1C', fontSize: '14px' }}>
            <strong>Dev Notice:</strong> {error}
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#7F1D1D' }}>
              Fallback Default: RAG is configured with <code>gemini-2.5-flash</code> as write-path enricher.
            </div>
          </div>
        )}

        {!loading && !error && models.length === 0 && (
          <div className="admin-empty-state">
            <div className="admin-empty-icon">🤖</div>
            <div className="admin-empty-title">No models registered</div>
            <div className="admin-empty-desc">
              Swoop is currently reporting an empty model pool. Check Swoop Admin Settings.
            </div>
          </div>
        )}

        {!loading && models.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model ID</th>
                <th>Name</th>
                <th>Provider</th>
                <th>Context Length</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{model.id}</td>
                  <td>{model.name}</td>
                  <td>
                    <span className="admin-source-label">{model.provider}</span>
                  </td>
                  <td style={{ color: 'var(--admin-text-muted)' }}>
                    {model.contextLength ? `${model.contextLength.toLocaleString()} tokens` : 'Standard'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
