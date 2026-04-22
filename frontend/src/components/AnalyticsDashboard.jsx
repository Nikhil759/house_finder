import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const STATS_SECRET = import.meta.env.VITE_STATS_SECRET || 'nestiq-stats-2026';

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 28,
        fontWeight: 700,
        color: accent ? 'var(--color-amber)' : 'var(--color-text-primary)',
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
      }}>
        {value ?? '—'}
      </span>
      {sub && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <p style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--color-text-muted)',
      margin: '20px 0 10px',
    }}>
      {children}
    </p>
  );
}

function Sparkline({ data }) {
  if (!data || data.length < 2) return (
    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px 0' }}>
      Not enough data yet
    </p>
  );
  const vals = data.map(d => d.visitors);
  const max = Math.max(...vals, 1);
  const w = 400;
  const h = 56;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - (v / max) * (h - 4);
    return `${x},${y}`;
  }).join(' ');
  const areaPath = `M0,${h} L${pts.split(' ').map(p => p).join(' L')} L${w},${h} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 56, display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-amber)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-amber)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#spark-grad)" />
        <polyline
          points={pts}
          fill="none"
          stroke="var(--color-amber)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {vals.map((v, i) => {
          const x = (i / (vals.length - 1)) * w;
          const y = h - (v / max) * (h - 4);
          return (
            <circle key={i} cx={x} cy={y} r="3" fill="var(--color-amber)" />
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
          {data[0]?.date}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
          {data.at(-1)?.date}
        </span>
      </div>
    </div>
  );
}

function BarList({ rows, keyLabel, valueLabel, maxVal }) {
  if (!rows || rows.length === 0) return (
    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', padding: '12px 0' }}>
      No data yet
    </p>
  );
  const max = maxVal ?? rows[0]?.[valueLabel] ?? 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((row, i) => {
        const val = row[valueLabel] ?? 0;
        const pct = Math.max(4, Math.round((val / max) * 100));
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '75%',
              }}>
                {row[keyLabel] || '/'}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-text-muted)',
                flexShrink: 0,
              }}>
                {fmtNum(val)}
              </span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--color-border)' }}>
              <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: 'var(--color-amber)', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewReturningBar({ newCount, returningCount }) {
  const total = (newCount || 0) + (returningCount || 0);
  if (!total) return null;
  const newPct = Math.round((newCount / total) * 100);
  return (
    <div>
      <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--color-border)', display: 'flex' }}>
        <div style={{ width: `${newPct}%`, background: 'var(--color-amber)', transition: 'width 0.4s ease' }} />
        <div style={{ flex: 1, background: 'rgba(245,166,35,0.25)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-amber)' }}>
            New
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {fmtNum(newCount)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>{newPct}%</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'right' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,166,35,0.6)' }}>
            Returning
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {fmtNum(returningCount)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>{100 - newPct}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AnalyticsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/stats`, {
        headers: { 'X-Stats-Token': STATS_SECRET },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastFetched(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          margin: 0,
        }}>
          Analytics
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastFetched && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
              {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchStats}
            disabled={loading}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '5px 10px',
              cursor: loading ? 'default' : 'pointer',
              color: loading ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
              transition: 'border-color 0.2s',
            }}
          >
            {loading ? '···' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 8,
          padding: '10px 14px',
          marginTop: 10,
          color: '#f87171',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)' }}>
            Loading…
          </span>
        </div>
      )}

      {data && (
        <>
          {/* ── Top-line stat cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <StatCard
              label="Unique visitors"
              value={fmtNum(data.unique_visitors_30d)}
              sub="last 30 days"
              accent
            />
            <StatCard
              label="Views today"
              value={fmtNum(data.views_today)}
              sub="page views"
            />
            <StatCard
              label="Total views"
              value={fmtNum(data.total_views_30d)}
              sub="last 30 days"
            />
            <StatCard
              label="Avg session"
              value={fmtDuration(data.avg_session_seconds)}
              sub="time on site"
            />
            <StatCard
              label="Visitors (7d)"
              value={fmtNum(data.unique_visitors_7d)}
              sub="last 7 days"
            />
            <StatCard
              label="Searches"
              value={fmtNum(data.search_count_30d)}
              sub="last 30 days"
            />
          </div>

          {/* ── Listing clicks ── */}
          {data.listing_clicks_30d > 0 && (
            <div style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: '14px 16px',
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
                Listing opens (30d)
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {fmtNum(data.listing_clicks_30d)}
              </span>
            </div>
          )}

          {/* ── Daily visitors sparkline ── */}
          <SectionLabel>Daily visitors — last 14 days</SectionLabel>
          <div style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <Sparkline data={data.daily_visitors} />
          </div>

          {/* ── New vs Returning ── */}
          {(data.new_visitors_30d > 0 || data.returning_visitors_30d > 0) && (
            <>
              <SectionLabel>New vs Returning — 30 days</SectionLabel>
              <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}>
                <NewReturningBar
                  newCount={data.new_visitors_30d}
                  returningCount={data.returning_visitors_30d}
                />
              </div>
            </>
          )}

          {/* ── Top routes ── */}
          {data.top_routes?.length > 0 && (
            <>
              <SectionLabel>Top pages — 30 days</SectionLabel>
              <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}>
                <BarList
                  rows={data.top_routes}
                  keyLabel="route"
                  valueLabel="views"
                  maxVal={data.top_routes[0]?.views}
                />
              </div>
            </>
          )}

          {/* ── Top localities ── */}
          {data.top_localities?.length > 0 && (
            <>
              <SectionLabel>Top localities — 30 days</SectionLabel>
              <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}>
                <BarList
                  rows={data.top_localities}
                  keyLabel="locality"
                  valueLabel="views"
                  maxVal={data.top_localities[0]?.views}
                />
              </div>
            </>
          )}

          {/* ── Top searches ── */}
          {data.top_searches?.length > 0 && (
            <>
              <SectionLabel>Top searches — 30 days</SectionLabel>
              <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}>
                <BarList
                  rows={data.top_searches}
                  keyLabel="query"
                  valueLabel="count"
                  maxVal={data.top_searches[0]?.count}
                />
              </div>
            </>
          )}

          {/* ── Top listings ── */}
          {data.top_listings?.length > 0 && (
            <>
              <SectionLabel>Most viewed listings — 30 days</SectionLabel>
              <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}>
                <BarList
                  rows={data.top_listings}
                  keyLabel="listing_id"
                  valueLabel="views"
                  maxVal={data.top_listings[0]?.views}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
