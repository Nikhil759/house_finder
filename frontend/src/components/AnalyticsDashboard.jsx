import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const STATS_SECRET = import.meta.env.VITE_STATS_SECRET || 'nestiq-stats-2026';

const PERIODS = [
  { key: '24h', label: '24h' },
  { key: '7d',  label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];

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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function periodLabel(key) {
  return PERIODS.find(p => p.key === key)?.label ?? key;
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
          return <circle key={i} cx={x} cy={y} r="3" fill="var(--color-amber)" />;
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
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 10, letterSpacing: '0.04em' }}>
        New = first visit ever in this window · Returning = visited before this window
      </p>
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
  // cache holds data per period key so switching is instant after first load
  const [cache, setCache] = useState({});
  const [loadingPeriods, setLoadingPeriods] = useState(new Set());
  const [errors, setErrors] = useState({});
  const [lastFetched, setLastFetched] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [showEmails, setShowEmails] = useState(false);

  const fetchPeriod = useCallback(async (p) => {
    if (loadingPeriods.has(p)) return;
    setLoadingPeriods(prev => new Set([...prev, p]));
    setErrors(prev => { const n = { ...prev }; delete n[p]; return n; });
    try {
      const res = await fetch(`${API_BASE}/api/stats?period=${p}`, {
        headers: { 'X-Stats-Token': STATS_SECRET },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCache(prev => ({ ...prev, [p]: json }));
      setLastFetched(new Date());
    } catch (e) {
      setErrors(prev => ({ ...prev, [p]: e.message }));
    } finally {
      setLoadingPeriods(prev => { const n = new Set(prev); n.delete(p); return n; });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all periods in parallel on mount
  useEffect(() => {
    PERIODS.forEach(p => fetchPeriod(p.key));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const data = cache[period] ?? null;
  const loading = loadingPeriods.has(period);
  const error = errors[period] ?? null;

  const refreshAll = useCallback(() => {
    setCache({});
    setErrors({});
    PERIODS.forEach(p => fetchPeriod(p.key));
  }, [fetchPeriod]);

  const pLabel = periodLabel(period);

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
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
            onClick={refreshAll}
            disabled={loadingPeriods.size > 0}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '5px 10px',
              cursor: loadingPeriods.size > 0 ? 'default' : 'pointer',
              color: loadingPeriods.size > 0 ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
            }}
          >
            {loadingPeriods.size > 0 ? `···${loadingPeriods.size < 4 ? ` (${4 - loadingPeriods.size}/4)` : ''}` : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Period filter ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {PERIODS.map(p => {
          const isActive = period === p.key;
          const isFetching = loadingPeriods.has(p.key);
          return (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '5px 10px',
                borderRadius: 6,
                border: isActive ? '1px solid var(--color-amber)' : '1px solid var(--color-border)',
                background: isActive ? 'rgba(245,166,35,0.12)' : 'none',
                color: isActive ? 'var(--color-amber)' : isFetching ? 'var(--color-text-muted)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                opacity: isFetching && !isActive ? 0.5 : 1,
              }}
            >
              {isFetching ? '···' : p.label}
            </button>
          );
        })}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatCard
              label="Unique visitors"
              value={fmtNum(data.unique_visitors)}
              sub={pLabel}
              accent
            />
            <StatCard
              label="Views today"
              value={fmtNum(data.views_today)}
              sub="page views"
            />
            <StatCard
              label="Total views"
              value={fmtNum(data.total_views)}
              sub={pLabel}
            />
            <StatCard
              label="Avg session"
              value={fmtDuration(data.avg_session_seconds)}
              sub={pLabel}
            />
            <StatCard
              label="Searches"
              value={fmtNum(data.search_count)}
              sub={pLabel}
            />
            <StatCard
              label="Listing opens"
              value={fmtNum(data.listing_clicks)}
              sub={pLabel}
            />
          </div>

          {/* ── Page views by section ── */}
          <SectionLabel>Page views by section — {pLabel}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <StatCard
              label="Locality Guide"
              value={fmtNum(data.page_views_pulse)}
              sub="visits"
            />
            <StatCard
              label="Listing Detail"
              value={fmtNum(data.page_views_listing_detail)}
              sub="visits"
            />
            <StatCard
              label="Neighbourhood"
              value={fmtNum(data.page_views_locality_guide)}
              sub="guide visits"
            />
          </div>

          {/* ── Visitors chart ── */}
          <SectionLabel>
            {period === '24h' ? 'Hourly visitors — last 24h' :
             period === '7d'  ? 'Daily visitors — last 7 days' :
             period === 'all' ? 'Monthly visitors — all time' :
                                'Daily visitors — last 14 days'}
          </SectionLabel>
          <div style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <Sparkline data={data.daily_visitors} />
          </div>

          {/* ── New vs Returning ── */}
          {data.new_visitors != null && (data.new_visitors > 0 || data.returning_visitors > 0) && (
            <>
              <SectionLabel>New vs Returning — {pLabel}</SectionLabel>
              <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}>
                <NewReturningBar
                  newCount={data.new_visitors}
                  returningCount={data.returning_visitors}
                />
              </div>
            </>
          )}

          {/* ── Top searches (areas) ── */}
          {data.top_searches?.length > 0 && (
            <>
              <SectionLabel>Top searched areas — {pLabel}</SectionLabel>
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

          {/* ── Top locality guide pages ── */}
          {data.top_localities?.length > 0 && (
            <>
              <SectionLabel>Top neighbourhood pages — {pLabel}</SectionLabel>
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

          {/* ── Top pages ── */}
          {data.top_routes?.length > 0 && (
            <>
              <SectionLabel>Top pages — {pLabel}</SectionLabel>
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

          {/* ── Top listings ── */}
          {data.top_listings?.length > 0 && (
            <>
              <SectionLabel>Most opened listings — {pLabel}</SectionLabel>
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

          {/* ── Saved properties ── */}
          <SectionLabel>Saved properties</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatCard
              label="Total saves"
              value={fmtNum(data.saved_listings_total)}
              sub="across all users"
            />
            <StatCard
              label="Users who saved"
              value={fmtNum(data.saved_listings_users)}
              sub="unique users"
            />
          </div>

          {/* ── App installs ── */}
          <SectionLabel>App installs</SectionLabel>
          <div style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.06em', display: 'block' }}>
                PWA installs
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 2, display: 'block' }}>
                tracked from May 2026 onwards
              </span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {fmtNum(data.app_installs)}
            </span>
          </div>

          {/* ── Registered users + login list ── */}
          <SectionLabel>Registered users</SectionLabel>
          <div style={{ marginBottom: 8 }}>
            <StatCard
              label="Total accounts"
              value={fmtNum(data.total_users)}
              sub="identified via PostHog"
              accent
            />
          </div>
          {data.login_emails?.length > 0 && (
            <div style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: '14px 16px',
            }}>
              <button
                onClick={() => setShowEmails(v => !v)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--color-amber)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  justifyContent: 'space-between',
                }}
              >
                <span>Email list ({data.login_emails.length})</span>
                <span>{showEmails ? '▲ hide' : '▼ show'}</span>
              </button>
              {showEmails && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.login_emails.map((email, i) => (
                    <span key={i} style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--color-text-primary)',
                      borderBottom: '1px solid var(--color-border)',
                      paddingBottom: 6,
                    }}>
                      {email}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
