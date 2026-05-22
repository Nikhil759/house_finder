import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import { captureApiError } from '../lib/posthog';
import { logStart, logSuccess, logError } from '../lib/apiLogger';
import {
  PULSE_LOCALITY_FEED_TABS,
  matchesPulseLocalityTab,
  pulseSourceColor,
  pulseSourceLabel,
} from '../lib/pulseSources';
const API_BASE = import.meta.env.VITE_API_URL || '';

const FEED_TABS = PULSE_LOCALITY_FEED_TABS;
const FEED_PAGE_SIZE = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────
function slugToLocality(slug) {
  // hsr-layout → HSR Layout, indiranagar → Indiranagar
  return slug
    .split('-')
    .map(w => w.toUpperCase() === w ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function timeAgoShort(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1)  return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeAgoLong(dateStr) {
  if (!dateStr) return null;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1)   return 'less than an hour ago';
  if (hours === 1) return '1 hour ago';
  if (hours < 24)  return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function formatRentShort(n) {
  if (!n) return '—';
  const v = Number(n);
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)   return `₹${(v / 1000).toFixed(0)}k`;
  return `₹${v}`;
}

function decodeHTML(str) {
  if (!str) return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const s = {
  page: {
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    minHeight: '100vh',
    paddingBottom: 100,
  },
  card: {
    background: 'var(--color-bg-surface)',
    borderRadius: 'var(--radius-card)',
    padding: '16px 18px',
  },
  monoSmall: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.06em',
    color: 'var(--color-text-muted)',
  },
  h2: {
    fontWeight: 300,
    fontSize: 18,
    letterSpacing: '-0.02em',
    marginBottom: 16,
  },
};

function SourceBadge({ sourceKey }) {
  const cfg = pulseSourceColor(sourceKey);
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
      textTransform: 'uppercase',
      background: cfg ? cfg.bg : 'var(--color-bg-card)',
      color: cfg ? cfg.color : 'var(--color-text-muted)',
      border: `1px solid ${cfg ? cfg.border : 'var(--color-border)'}`,
      borderRadius: 4, padding: '3px 8px',
    }}>
      {pulseSourceLabel(sourceKey)}
    </span>
  );
}

function FeedItem({ item }) {
  return (
    <article style={s.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <SourceBadge sourceKey={item.sourceKey} />
        <span style={s.monoSmall}>{item.channel}</span>
        <span style={{ ...s.monoSmall, marginLeft: 'auto' }}>{item.timeAgo}</span>
      </div>
      <h3 style={{ fontWeight: 300, fontSize: 15, lineHeight: 1.4, marginBottom: 8 }}>
        {item.title}
      </h3>
      <p style={{
        fontSize: 13,
        color: 'var(--color-text-muted)',
        lineHeight: 1.6,
        marginBottom: item.url ? 6 : 0,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {item.body}
      </p>
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-amber)',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Read more →
        </a>
      )}
    </article>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function PulseLocality() {
  const { locality: slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useDesktop();
  const [feedTab, setFeedTab] = useState('All');
  const [feedPage, setFeedPage] = useState(1);

  // Derived locality name from slug
  const locality = slugToLocality(slug);

  // Data state
  const [statsRows,    setStatsRows]    = useState([]);
  const [depositRows,  setDepositRows]  = useState([]);
  const [feedPosts,    setFeedPosts]    = useState([]);
  const [topicCounts,  setTopicCounts]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [feedLoading,  setFeedLoading]  = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [fetchError,   setFetchError]   = useState(null);
  const [localityImage, setLocalityImage] = useState(null);
  const [sentimentData, setSentimentData] = useState(null);

  // Fetch all data via Flask APIs
  useEffect(() => {
    let cancelled = false;
    const loc = encodeURIComponent(locality);

    async function load() {
      setLoading(true);
      setFeedLoading(true);
      setNotFound(false);
      setFetchError(null);
      const t0 = performance.now();
      const endpoint = `/api/locality-stats/${loc}`;
      logStart(endpoint);

      try {
        const [statsRes, sentRes, imgRes, feedRes] = await Promise.all([
          fetch(`${API_BASE}/api/locality-stats/${loc}`).then(r => { if (!r.ok) throw new Error(`locality-stats ${r.status}`); return r.json(); }).catch(() => null),
          fetch(`${API_BASE}/api/pulse/locality/${loc}`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API_BASE}/api/locality-image/${loc}`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API_BASE}/api/pulse/feed-for-locality/${loc}`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (cancelled) return;

        const sData = statsRes?.rent_stats || [];
        if (sData.length === 0) {
          setNotFound(true);
        } else {
          setStatsRows(sData);
          setDepositRows(statsRes?.deposit_stats || []);
        }

        if (sentRes) setSentimentData(sentRes);
        if (imgRes?.image_url) setLocalityImage(imgRes);

        if (feedRes) {
          const sorted = (feedRes.topics || [])
            .map(t => ({
              label: t.topic.charAt(0).toUpperCase() + t.topic.slice(1),
              count: t.count,
            }))
            .sort((a, b) => {
              if (a.label.toLowerCase() === 'other') return 1;
              if (b.label.toLowerCase() === 'other') return -1;
              return b.count - a.count;
            });
          setTopicCounts(sorted);
          setFeedPosts(feedRes.posts || []);
        }
        logSuccess(endpoint, (statsRes?.rent_stats || []).length, performance.now() - t0);
      } catch (err) {
        logError(endpoint, err.message, performance.now() - t0);
        if (!cancelled) setFetchError({ message: err.message || 'Failed to load locality data' });
        captureApiError(err, { endpoint: `/api/locality-stats/${loc}` });
      } finally {
        if (!cancelled) { setLoading(false); setFeedLoading(false); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [locality]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const bhk2          = statsRows.find(r => r.bhk === '2 BHK');
  const totalListings = statsRows.reduce((acc, r) => acc + (r.listing_count || 0), 0);
  const updatedAt     = statsRows.length
    ? statsRows.reduce((a, b) => new Date(a.updated_at) > new Date(b.updated_at) ? a : b).updated_at
    : null;
  const depositRow2bhk = depositRows.find(r => r.bhk === '2 BHK');

  // Backend now returns `avg_sentiment_30d` (30-day rolling window). The older
  // `avg_sentiment_7d` key is kept as a backward-compat alias so existing /
  // cached responses still work — but we prefer the new key when available.
  const sentimentScore = sentimentData?.avg_sentiment_30d ?? sentimentData?.avg_sentiment_7d;
  const sentimentLabel = sentimentScore == null ? '—'
    : sentimentScore >= 0.3  ? 'Bullish'
    : sentimentScore >= 0.1  ? 'Optimistic'
    : sentimentScore <= -0.3 ? 'Bearish'
    : sentimentScore <= -0.1 ? 'Pessimistic'
    : 'Neutral';
  const sentimentColor = sentimentScore == null ? 'var(--color-text-muted)'
    : sentimentScore >= 0.1  ? '#34D399'
    : sentimentScore <= -0.1 ? '#F87171'
    : 'var(--color-amber)';

  const rentTrend2bhk = bhk2?.rent_trend_pct != null ? Number(bhk2.rent_trend_pct) : null;
  const rentTrendSub = rentTrend2bhk != null
    ? `${rentTrend2bhk > 0 ? '▲' : '▼'} ${Math.abs(rentTrend2bhk).toFixed(1)}% vs 30d ago`
    : null;
  const rentTrendColor = rentTrend2bhk == null ? undefined
    : rentTrend2bhk > 0 ? '#34D399' : '#F87171';

  const stats = loading ? [
    { label: 'Avg 2BHK Rent',  value: '—' },
    { label: 'Total Listings', value: '—' },
    { label: 'Deposit Mult.',  value: '—' },
    { label: 'Sentiment',      value: '—' },
  ] : [
    { label: 'Avg 2BHK Rent',  value: formatRentShort(bhk2?.median_rent),
      sub: rentTrendSub, subColor: rentTrendColor },
    { label: 'Total Listings', value: totalListings > 0 ? String(totalListings) : '—' },
    { label: 'Deposit Mult.',  value: depositRow2bhk ? `${Number(depositRow2bhk.avg_multiplier).toFixed(1)}×` : '—' },
    { label: 'Sentiment',      value: sentimentLabel, color: sentimentColor,
      sub: sentimentScore != null
        ? `${sentimentScore >= 0 ? '+' : ''}${sentimentScore.toFixed(2)} · ${sentimentData.post_count_30d ?? sentimentData.post_count_7d ?? 0} posts (30d)`
        : null },
  ];

  // ── Derived market depth ───────────────────────────────────────────────────
  const depth = useMemo(() => {
    if (statsRows.length === 0) return [];
    const maxVal = Math.max(
      ...statsRows.map(r => r.p75_rent || r.median_rent || 0),
      1
    );
    return ['1 BHK', '2 BHK', '3 BHK'].map(bhk => {
      const row = statsRows.find(r => r.bhk === bhk);
      if (!row) return null;
      return {
        config: bhk,
        range: `${formatRentShort(row.p25_rent)} – ${formatRentShort(row.p75_rent)}`,
        low:   row.p25_rent || 0,
        high:  row.p75_rent || row.median_rent || 0,
        max:   maxVal,
      };
    }).filter(Boolean);
  }, [statsRows]);

  // ── Derived visible feed ───────────────────────────────────────────────────
  const maxInsight = topicCounts.length > 0
    ? Math.max(...topicCounts.map(i => i.count))
    : 1;

  const visibleFeed = useMemo(() => {
    const posts = feedTab === 'All'
      ? feedPosts
      : feedPosts.filter(p => matchesPulseLocalityTab(p, feedTab));

    return posts.map(p => ({
      id:        p.id,
      sourceKey: p.source,
      channel:   p.author || p.locality || '',
      timeAgo:   timeAgoShort(p.posted_at),
      title:     p.title || '',
      body:      decodeHTML(p.body) || '',
      url:       p.url,
    }));
  }, [feedPosts, feedTab]);

  // Reset to page 1 whenever the tab changes (or the underlying post list shrinks
  // below the current page) so users never end up on an empty page.
  useEffect(() => {
    setFeedPage(1);
  }, [feedTab]);

  const totalFeedPages = Math.max(1, Math.ceil(visibleFeed.length / FEED_PAGE_SIZE));
  const pagedFeed      = visibleFeed.slice((feedPage - 1) * FEED_PAGE_SIZE, feedPage * FEED_PAGE_SIZE);

  // ── Error state ────────────────────────────────────────────────────────────
  if (fetchError && !loading) {
    return (
      <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, padding: '80px 24px', textAlign: 'center' }}>
        <DesktopSidebar />
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>Something went wrong loading locality data. Please try again.</p>
        <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--color-amber)', background: 'transparent', color: 'var(--color-amber)', fontWeight: 600, cursor: 'pointer' }}>Retry</button>
        {!isDesktop && <BottomNav />}
      </div>
    );
  }

  // ── Graceful fallback for unknown slugs ────────────────────────────────────
  if (notFound && !loading) {
    return (
      <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, padding: '80px 24px', textAlign: 'center' }}>
        <DesktopSidebar />
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Locality not found.
        </p>
        <Link to="/locality-guide" style={{ color: 'var(--color-amber)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          ← Back to Pulse
        </Link>
        {!isDesktop && <BottomNav />}
      </div>
    );
  }

  return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0 }}>

      <DesktopSidebar />
      <AppHeader backTo />

      {/* ── DESKTOP BACK BAR ──
         AppHeader is hidden on desktop, so we expose a sticky back button
         here for users to return to the previous page (Pulse / locality list). */}
      {isDesktop && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 90,
          display: 'flex',
          alignItems: 'center',
          padding: '12px 24px',
          background: 'rgba(10,10,10,0.92)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <button
            onClick={() => {
              if (location.key && location.key !== 'default') {
                navigate(-1);
              } else {
                navigate('/locality-guide');
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              padding: '6px 14px',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '0.05em',
              transition: 'color 0.2s, border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-text-primary)';
              e.currentTarget.style.borderColor = 'var(--color-text-primary)';
              e.currentTarget.style.background = 'var(--color-bg-surface)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-muted)';
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.background = 'none';
            }}
          >
            ← Back to Pulse
          </button>
        </div>
      )}

      {/* ── HERO IMAGE ──
         On desktop the container is much wider than on mobile (~1000px vs ~400px),
         so with a fixed 220px height the aspect ratio gets very wide and
         `background-size: cover` crops out most of the image vertically. We give
         desktop a taller hero so a bigger slice of the photo stays visible. */}
      {localityImage ? (
        <div style={{
          position: 'relative',
          width: '100%',
          height: isDesktop ? 380 : 220,
          backgroundImage: `url(${localityImage.image_url})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 35%',
          overflow: 'hidden',
        }}>
          {/* Dark gradient overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 60%)',
          }} />
          {/* Locality name on top of image */}
          <div style={{
            position: 'absolute', bottom: 36, left: 16, right: 16,
          }}>
            <h1 style={{
              fontWeight: 300, fontSize: 30, letterSpacing: '-0.025em',
              color: '#fff', marginBottom: 4,
            }}>
              {locality}
            </h1>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: 'rgba(255,255,255,0.75)', letterSpacing: '0.06em',
            }}>
              {loading ? '…' : `${totalListings} active listings`}
              {updatedAt && ` · Updated ${timeAgoLong(updatedAt)}`}
            </p>
          </div>
          {/* Attribution — required by Google ToS */}
          <span style={{
            position: 'absolute', bottom: 8, right: 10,
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'rgba(255,255,255,0.6)',
          }}>
            📷 Google
          </span>
        </div>
      ) : null}

      <div style={{ padding: '24px 16px 0' }}>

        {/* ── TITLE (shown only when no hero image) ── */}
        {!localityImage && (
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontWeight: 300, fontSize: 30, letterSpacing: '-0.025em', marginBottom: 6 }}>
              {locality}
            </h1>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
              {loading ? '…' : `${totalListings} active listings`}
              {updatedAt && ` · Updated ${timeAgoLong(updatedAt)}`}
            </p>
          </div>
        )}

        {/* ── STATS ROW ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8, marginBottom: 32,
        }}>
          {stats.map(stat => (
            <div key={stat.label} style={s.card}>
              <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                {stat.label}
              </p>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
                color: stat.color || 'var(--color-text-primary)', letterSpacing: '-0.02em',
              }}>
                {stat.value}
              </p>
              {stat.sub && (
                <p style={{ ...s.monoSmall, fontSize: 9, marginTop: 2, color: stat.subColor || 'var(--color-text-muted)' }}>
                  {stat.sub}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ── MARKET DEPTH ── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={s.h2}>Market Depth by Configuration</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <p style={{ ...s.monoSmall, padding: '8px 0', opacity: 0.5 }}>Loading…</p>
            ) : depth.length === 0 ? (
              <p style={{ ...s.monoSmall, padding: '8px 0', opacity: 0.5 }}>No data available.</p>
            ) : (
              depth.map(d => (
                <div key={d.config} style={s.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <span style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {d.config}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-text-primary)' }}>
                      {d.range}
                    </span>
                  </div>
                  {/* Range bar */}
                  <div style={{
                    height: 4, background: 'var(--color-border)',
                    borderRadius: 'var(--radius-pill)', position: 'relative', overflow: 'visible',
                  }}>
                    <div style={{
                      position: 'absolute',
                      left: `${(d.low / d.max) * 100}%`,
                      width: `${Math.min(100 - (d.low / d.max) * 100, ((d.high - d.low) / d.max) * 100)}%`,
                      height: '100%',
                      background: 'var(--color-amber)',
                      borderRadius: 'var(--radius-pill)',
                      opacity: 0.7,
                    }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── TRENDING TOPICS ── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={s.h2}>Trending Topics</h2>
          <p style={{
            ...s.monoSmall,
            marginTop: -4,
            marginBottom: 14,
            opacity: 0.7,
            lineHeight: 1.5,
            maxWidth: 640,
          }}>
            What people are talking about in this area — counted from community posts
            (Reddit, Telegram &amp; local news) over the last 30 days. Longer bar = more mentions.
          </p>
          <div style={{ ...s.card }}>
            {feedLoading ? (
              <p style={{ ...s.monoSmall, opacity: 0.5 }}>Loading…</p>
            ) : topicCounts.length === 0 ? (
              <p style={{ ...s.monoSmall, opacity: 0.5 }}>No insight data yet for this area.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {topicCounts.map(ins => (
                  <div key={ins.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <span style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        {ins.label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {ins.count}
                      </span>
                    </div>
                    <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${(ins.count / maxInsight) * 100}%`,
                        background: 'var(--color-amber)',
                        borderRadius: 'var(--radius-pill)',
                        opacity: 0.5 + (ins.count / maxInsight) * 0.5,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p style={{ ...s.monoSmall, marginTop: 14, fontSize: 10, opacity: 0.6 }}>
              Powered by Gemini ✦
            </p>
          </div>
        </section>

        {/* ── SIGNALS FEED ── */}
        <section style={{ marginBottom: 24 }}>
          <h2 style={s.h2}>Signals & Discussions</h2>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {FEED_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setFeedTab(tab)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                  background: feedTab === tab ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                  color: feedTab === tab ? '#1a0a00' : 'var(--color-text-muted)',
                  border: feedTab === tab ? 'none' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-pill)', padding: '6px 14px',
                  cursor: 'pointer', transition: 'background 0.2s, color 0.2s',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {feedLoading ? (
              <p style={{ ...s.monoSmall, padding: '24px 0', textAlign: 'center', opacity: 0.5 }}>
                Loading signals…
              </p>
            ) : visibleFeed.length === 0 ? (
              <p style={{ ...s.monoSmall, padding: '24px 0', textAlign: 'center' }}>
                No signals for this source yet.
              </p>
            ) : (
              pagedFeed.map(item => <FeedItem key={item.id} item={item} />)
            )}
          </div>

          {/* Feed pagination — only shown when there's more than one page */}
          {!feedLoading && totalFeedPages > 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px solid var(--color-border)',
            }}>
              <button
                onClick={() => setFeedPage(p => Math.max(1, p - 1))}
                disabled={feedPage === 1}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                  background: 'var(--color-bg-surface)',
                  color: feedPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6, padding: '7px 14px',
                  cursor: feedPage === 1 ? 'not-allowed' : 'pointer',
                  opacity: feedPage === 1 ? 0.4 : 1,
                  transition: 'border-color 0.15s, color 0.15s',
                }}
              >
                ← Previous
              </button>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--color-text-muted)', letterSpacing: '0.05em',
              }}>
                Page {feedPage} of {totalFeedPages}
              </span>
              <button
                onClick={() => setFeedPage(p => Math.min(totalFeedPages, p + 1))}
                disabled={feedPage === totalFeedPages}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                  background: feedPage === totalFeedPages ? 'var(--color-bg-surface)' : 'var(--color-amber)',
                  color: feedPage === totalFeedPages ? 'var(--color-text-muted)' : '#1a0a00',
                  border: feedPage === totalFeedPages ? '1px solid var(--color-border)' : 'none',
                  borderRadius: 6, padding: '7px 14px',
                  cursor: feedPage === totalFeedPages ? 'not-allowed' : 'pointer',
                  opacity: feedPage === totalFeedPages ? 0.4 : 1,
                  transition: 'background 0.15s, color 0.15s',
                  fontWeight: 500,
                }}
              >
                Next →
              </button>
            </div>
          )}
        </section>

      </div>

      <BottomNav />
    </div>
  );
}
