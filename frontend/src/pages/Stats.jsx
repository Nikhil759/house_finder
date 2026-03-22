import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import '../global.css'

const OWNER_EMAIL = 'bn5799@gmail.com'
const STATS_SECRET = 'nestiq-stats-2026'
const API_BASE = import.meta.env.VITE_API_URL || ''

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
        {value ?? '—'}
      </span>
      {sub && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</span>}
    </div>
  )
}

function Sparkline({ data }) {
  if (!data || data.length < 2) return null
  const vals = data.map(d => d.visitors)
  const max = Math.max(...vals, 1)
  const w = 300
  const h = 60
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w
    const y = h - (v / max) * h
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 60, display: 'block' }}>
      <polyline
        points={pts}
        fill="none"
        stroke="#f5a623"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Stats() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastFetched, setLastFetched] = useState(null)

  const isOwner = user?.email === OWNER_EMAIL

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/stats`, {
        headers: { 'X-Stats-Token': STATS_SECRET },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setLastFetched(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && isOwner) fetchStats()
  }, [authLoading, isOwner, fetchStats])

  if (authLoading) return (
    <div className="app-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <span style={{ color: 'var(--text-secondary)' }}>Loading…</span>
    </div>
  )

  if (!user || !isOwner) return (
    <div className="app-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12 }}>
      <span style={{ fontSize: 32 }}>🔒</span>
      <span style={{ color: 'var(--text-secondary)' }}>Not authorised</span>
      <button onClick={() => navigate('/')} style={btnStyle}>Go home</button>
    </div>
  )

  return (
    <div className="app-page" style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px 40px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            NestIQ Stats
          </h1>
          {lastFetched && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
        </div>
        <button onClick={fetchStats} disabled={loading} style={btnStyle}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, color: '#f87171', fontSize: 14 }}>
          Error: {error}
        </div>
      )}

      {!data && !loading && !error && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 60 }}>No data yet.</p>
      )}

      {data && (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <StatCard label="Visitors (30d)" value={data.unique_visitors_30d} sub="unique users" />
            <StatCard label="Views today" value={data.views_today} sub="page views" />
            <StatCard label="Total views (30d)" value={data.total_views_30d} sub="page views" style={{ gridColumn: '1 / -1' }} />
          </div>

          {/* Sparkline */}
          {data.daily_visitors?.length > 1 && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '16px 20px',
              marginBottom: 20,
            }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Daily visitors — last 14 days
              </p>
              <Sparkline data={data.daily_visitors} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data.daily_visitors[0]?.date}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data.daily_visitors.at(-1)?.date}</span>
              </div>
            </div>
          )}

          {/* Top routes */}
          {data.top_routes?.length > 0 && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '16px 20px',
            }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Top pages (30d)
              </p>
              {data.top_routes.map((r, i) => {
                const max = data.top_routes[0]?.views || 1
                const pct = Math.round((r.views / max) * 100)
                return (
                  <div key={i} style={{ marginBottom: i < data.top_routes.length - 1 ? 10 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                      <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{r.route}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{r.views}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--border)' }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: '#f5a623' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const btnStyle = {
  background: '#f5a623',
  color: '#000',
  border: 'none',
  borderRadius: 10,
  padding: '8px 16px',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
}
