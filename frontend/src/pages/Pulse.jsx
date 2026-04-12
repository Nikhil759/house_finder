import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import { supabase } from '../lib/supabase';

// ── Constants ─────────────────────────────────────────────────────────────────

const FEED_TABS = ['All', 'Discussion', 'News'];
const PAGE_SIZE = 6;

const SENTIMENT_COLORS = {
  positive: '#34D399',
  negative: '#F87171',
  neutral:  '#9CA3AF',
};

function sentimentArrow(score) {
  if (score >= 0.15) return { symbol: '▲', color: SENTIMENT_COLORS.positive };
  if (score <= -0.15) return { symbol: '▼', color: SENTIMENT_COLORS.negative };
  return { symbol: '–', color: SENTIMENT_COLORS.neutral };
}

function formatScore(score) {
  if (score == null) return '0.0';
  const s = Number(score);
  return (s >= 0 ? '+' : '') + s.toFixed(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgoShort(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function decodeHTML(str) {
  if (!str) return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function localityToSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TopicTicker({ topics }) {
  if (!topics || topics.length === 0) return null;

  const tickerItems = topics.map(t => {
    const arrow = sentimentArrow(t.avg_sentiment);
    return (
      <div key={t.slug} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        flexShrink: 0, padding: '0 12px',
      }}>
        <span className="type-eyebrow" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
          {t.label}
        </span>
        <span className="type-data" style={{ color: arrow.color, fontSize: 'var(--text-xs)' }}>
          {arrow.symbol} {Math.abs(t.avg_sentiment).toFixed(1)}
        </span>
      </div>
    );
  });

  return (
    <div style={{
      overflow: 'hidden',
      borderTop: '1px solid var(--color-border)',
      borderBottom: '1px solid var(--color-border)',
      padding: '10px 0',
      marginBottom: 24,
    }}>
      <div className="pulse-ticker-track">
        <div className="pulse-ticker-content">
          {tickerItems}
        </div>
        <div className="pulse-ticker-content" aria-hidden="true">
          {tickerItems}
        </div>
      </div>
    </div>
  );
}

function SentimentBadge({ score }) {
  const s = Number(score || 0);
  let bg, color;
  if (s >= 0.15) {
    bg = 'rgba(52,211,153,0.12)';
    color = SENTIMENT_COLORS.positive;
  } else if (s <= -0.15) {
    bg = 'rgba(248,113,113,0.12)';
    color = SENTIMENT_COLORS.negative;
  } else {
    bg = 'rgba(156,163,175,0.12)';
    color = SENTIMENT_COLORS.neutral;
  }

  return (
    <span className="type-data" style={{
      background: bg,
      color,
      padding: '3px 8px',
      borderRadius: 4,
      fontSize: 'var(--text-xs)',
      letterSpacing: 'var(--tracking-wide)',
    }}>
      SENTIMENT {formatScore(score)}
    </span>
  );
}

function CategoryBadge({ category }) {
  const key = (category || '').toLowerCase();
  const map = {
    discussion: { color: '#F97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.3)' },
    news:       { color: '#60A5FA', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)' },
    listing:    { color: '#A78BFA', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' },
  };
  const cfg = map[key] || map.discussion;

  return (
    <span className="type-eyebrow" style={{
      background: cfg.bg,
      color: cfg.color,
      border: `1px solid ${cfg.border}`,
      borderRadius: 4,
      padding: '2px 8px',
      fontSize: 'var(--text-xs)',
    }}>
      {category || 'discussion'}
    </span>
  );
}

function SignalCard({ post }) {
  const localities = post.detected_localities || [];
  const breadcrumb = localities.length > 0
    ? localities.slice(0, 2).join(' // ')
    : (post.locality || 'Bengaluru');

  return (
    <article style={{
      background: 'var(--color-bg-surface)',
      borderRadius: 'var(--radius-card)',
      padding: '20px',
      marginBottom: 10,
      borderLeft: '3px solid transparent',
      borderImage: post.relevance_score >= 0.7
        ? 'linear-gradient(to bottom, var(--color-amber), transparent) 1'
        : undefined,
    }}>
      {/* Top row: sentiment badge + category + time */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        flexWrap: 'wrap', marginBottom: 12,
      }}>
        <SentimentBadge score={post.sentiment_score} />
        <CategoryBadge category={post.category} />
        <span className="type-data" style={{
          marginLeft: 'auto',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)',
        }}>
          {post.timeAgo}
        </span>
      </div>

      {/* Breadcrumb: locality // topic */}
      <p className="type-eyebrow" style={{
        color: 'var(--color-text-muted)',
        marginBottom: 8,
        fontSize: 'var(--text-xs)',
      }}>
        {breadcrumb.toUpperCase()}
        {post.canonical_topic && (
          <> // {post.canonical_topic.toUpperCase()}</>
        )}
      </p>

      {/* Headline */}
      <h3 style={{
        fontWeight: 'var(--weight-regular)',
        fontSize: 'var(--text-base)',
        lineHeight: 'var(--leading-snug)',
        marginBottom: 8,
      }}>
        {post.title}
      </h3>

      {/* Body — 2 lines max */}
      <p className="type-secondary" style={{
        color: 'var(--color-text-muted)',
        lineHeight: 'var(--leading-normal)',
        marginBottom: post.url ? 8 : 12,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {post.body}
      </p>

      {/* Read more link */}
      {post.url && (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="type-data"
          style={{
            color: 'var(--color-amber)',
            textDecoration: 'none',
            display: 'inline-block',
            marginBottom: 12,
            fontSize: 'var(--text-xs)',
          }}
        >
          READ FULL SIGNAL →
        </a>
      )}

      {/* Bottom metadata chips */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {post.relevance_score != null && (
          <span className="type-data" style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}>
            Relevance {(post.relevance_score * 100).toFixed(0)}%
          </span>
        )}
        {post.source && (
          <span className="type-data" style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}>
            via {post.source}
          </span>
        )}
      </div>
    </article>
  );
}

const BHK_OPTIONS = ['1 BHK', '2 BHK', '3 BHK'];

function LocalityActivityCard({ localities, rentData, navigate }) {
  const [selectedBhk, setSelectedBhk] = useState('2 BHK');

  if (!localities || localities.length === 0) return null;

  const rentMap = {};
  if (rentData) {
    for (const row of rentData) {
      if (row.bhk === selectedBhk) {
        rentMap[row.locality.toLowerCase()] = {
          median: row.median_rent,
          trend: row.rent_trend_pct,
        };
      }
    }
  }

  function formatRent(val) {
    if (!val) return '—';
    const n = Number(val);
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
    return `₹${n}`;
  }



  return (
    <div style={{
      background: 'var(--color-bg-surface)',
      borderRadius: 'var(--radius-card)',
      padding: '20px',
      marginBottom: 24,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 16,
      }}>
        <p className="type-eyebrow" style={{
          color: 'var(--color-amber)',
          fontSize: 'var(--text-xs)',
          margin: 0,
        }}>
          LOCALITY ACTIVITY
        </p>
        {/* BHK toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {BHK_OPTIONS.map(bhk => (
            <button
              key={bhk}
              onClick={() => setSelectedBhk(bhk)}
              className="type-data"
              style={{
                fontSize: '10px',
                padding: '3px 8px',
                borderRadius: 'var(--radius-pill)',
                border: selectedBhk === bhk ? 'none' : '1px solid var(--color-border)',
                background: selectedBhk === bhk ? 'var(--color-amber)' : 'transparent',
                color: selectedBhk === bhk ? '#1a0a00' : 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              {bhk}
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '0 0 8px', borderBottom: '1px solid var(--color-border)',
        marginBottom: 4,
      }}>
        <span className="type-eyebrow" style={{ color: 'var(--color-text-muted)', fontSize: '10px', flex: 1 }}>
          Locality
        </span>
        <span className="type-eyebrow" style={{ color: 'var(--color-text-muted)', fontSize: '10px', width: 70, textAlign: 'right' }}>
          Avg Rent
        </span>
        <span className="type-eyebrow" style={{ color: 'var(--color-text-muted)', fontSize: '10px', width: 70, textAlign: 'right' }}>
          Status
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {localities.map(loc => {
          const arrow = sentimentArrow(loc.avg_sentiment);
          let status = 'STABLE';
          if (loc.avg_sentiment >= 0.3) status = 'OPTIMAL';
          else if (loc.avg_sentiment <= -0.3) status = 'VOLATILE';

          const rentInfo = rentMap[loc.locality.toLowerCase()];

          return (
            <div
              key={loc.locality}
              onClick={() => navigate(`/neighbourhood-pulse/${localityToSlug(loc.locality)}`)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                padding: '8px 0',
                borderBottom: '1px solid var(--color-border)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-card)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ''; }}
            >
              <span style={{
                fontWeight: 'var(--weight-regular)',
                fontSize: 'var(--text-sm)',
                flex: 1,
              }}>
                {loc.locality}
              </span>
              <span className="type-data" style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-primary)',
                width: 70,
                textAlign: 'right',
              }}>
                {formatRent(rentInfo?.median)}
              </span>
              <span className="type-data" style={{
                color: arrow.color,
                fontSize: 'var(--text-xs)',
                width: 70,
                textAlign: 'right',
              }}>
                {status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────

export default function Pulse() {
  const navigate = useNavigate();
  const isDesktop = useDesktop();

  const [feedTab, setFeedTab] = useState('All');
  const [feedPage, setFeedPage] = useState(0);

  const [feedPosts, setFeedPosts] = useState([]);
  const [topicStats, setTopicStats] = useState([]);
  const [localityStats, setLocalityStats] = useState([]);
  const [rentData, setRentData] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Data fetching ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [postsRes, topicsRes, localityRes, rentRes] = await Promise.all([
        // Recent tagged posts (discussion + news only, sorted by relevance then recency)
        supabase
          .from('locality_feed')
          .select('id, source, locality, title, body, url, category, canonical_topic, sentiment_score, relevance_score, detected_localities, posted_at, scraped_at')
          .in('category', ['discussion', 'news'])
          .gte('relevance_score', 0.3)
          .order('scraped_at', { ascending: false })
          .limit(50),

        // Topic volume (last 30 days)
        supabase
          .from('locality_feed')
          .select('canonical_topic, sentiment_score')
          .in('category', ['discussion', 'news'])
          .not('canonical_topic', 'is', null)
          .gte('scraped_at', thirtyDaysAgo),

        // Per-locality average sentiment (last 7 days)
        supabase
          .from('locality_feed')
          .select('locality, sentiment_score')
          .in('category', ['discussion', 'news'])
          .not('locality', 'is', null)
          .not('sentiment_score', 'is', null)
          .gte('scraped_at', sevenDaysAgo),

        // Rent stats + trend for all localities + BHK combos
        supabase
          .from('locality_stats_cache')
          .select('locality, bhk, median_rent, rent_trend_pct')
          .order('median_rent', { ascending: false }),
      ]);

      if (cancelled) return;

      setRentData(rentRes.data || []);

      // Posts
      setFeedPosts((postsRes.data || []).map(p => ({
        ...p,
        title: p.title || '',
        body: decodeHTML(p.body) || '',
        timeAgo: timeAgoShort(p.posted_at || p.scraped_at),
      })));

      // Topic aggregation: count + avg sentiment per topic
      if (topicsRes.data) {
        const byTopic = {};
        for (const row of topicsRes.data) {
          const t = row.canonical_topic;
          if (!t || t === 'other') continue;
          if (!byTopic[t]) byTopic[t] = { count: 0, sentimentSum: 0 };
          byTopic[t].count++;
          byTopic[t].sentimentSum += (row.sentiment_score || 0);
        }
        const sorted = Object.entries(byTopic)
          .map(([slug, d]) => ({
            slug,
            label: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            count: d.count,
            avg_sentiment: d.count > 0 ? d.sentimentSum / d.count : 0,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);
        setTopicStats(sorted);
      }

      // Locality aggregation: avg sentiment per locality
      if (localityRes.data) {
        const byLoc = {};
        for (const row of localityRes.data) {
          const loc = row.locality;
          if (!byLoc[loc]) byLoc[loc] = { count: 0, sentimentSum: 0 };
          byLoc[loc].count++;
          byLoc[loc].sentimentSum += (row.sentiment_score || 0);
        }
        const sorted = Object.entries(byLoc)
          .map(([locality, d]) => ({
            locality,
            count: d.count,
            avg_sentiment: d.count > 0 ? d.sentimentSum / d.count : 0,
          }))
          .filter(l => l.count >= 2)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);
        setLocalityStats(sorted);
      }

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Derived: aggregated city sentiment ─────────────────────────────────────

  const citySentiment = useMemo(() => {
    if (feedPosts.length === 0) return { score: 0, label: 'Calibrating' };
    const scores = feedPosts.filter(p => p.sentiment_score != null).map(p => p.sentiment_score);
    if (scores.length === 0) return { score: 0, label: 'Calibrating' };
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    let label = 'Neutral';
    if (avg >= 0.3) label = 'Bullish';
    else if (avg >= 0.1) label = 'Cautiously Optimistic';
    else if (avg <= -0.3) label = 'Bearish';
    else if (avg <= -0.1) label = 'Cautiously Pessimistic';
    return { score: avg, label };
  }, [feedPosts]);

  // ── Derived: filtered feed ────────────────────────────────────────────────

  const filteredFeed = useMemo(() => {
    if (feedTab === 'All') return feedPosts;
    return feedPosts.filter(p => (p.category || '').toLowerCase() === feedTab.toLowerCase());
  }, [feedPosts, feedTab]);

  const totalPages = Math.ceil(filteredFeed.length / PAGE_SIZE);
  const pagedFeed = filteredFeed.slice(feedPage * PAGE_SIZE, (feedPage + 1) * PAGE_SIZE);

  return (
    <div className="nestiq-page-body" style={{
      background: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-sans)',
      minHeight: '100vh',
    }}>
      <DesktopSidebar />
      <AppHeader />

      <div style={{
        padding: isDesktop ? '24px 32px 40px' : '16px 16px 100px',
        maxWidth: isDesktop ? 1200 : undefined,
        margin: isDesktop ? '0 auto' : undefined,
      }}>

        {/* ── DOSSIER HEADER ── */}
        <div style={{ marginBottom: 0 }}>
          <p className="type-eyebrow" style={{
            color: 'var(--color-amber)',
            marginBottom: 12,
            fontSize: 'var(--text-xs)',
          }}>
            NestIQ Intelligence // Live
          </p>
          <h1 style={{
            fontWeight: 'var(--weight-light)',
            fontSize: 'var(--text-xl)',
            letterSpacing: 'var(--tracking-snug)',
            lineHeight: 'var(--leading-tight)',
            marginBottom: 16,
          }}>
            The Bangalore Pulse
          </h1>

          {/* Sentiment score + label row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <span className="type-data" style={{
              fontSize: 'var(--text-lg)',
              color: 'var(--color-amber)',
            }}>
              {formatScore(citySentiment.score)}
            </span>
            <div>
              <p className="type-eyebrow" style={{
                color: 'var(--color-text-muted)',
                marginBottom: 2,
                fontSize: 'var(--text-xs)',
              }}>
                Aggregated Sentiment
              </p>
              <p className="type-data" style={{
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
              }}>
                {citySentiment.label}
              </p>
            </div>
          </div>
        </div>

        {/* ── TOPIC TICKER (auto-scrolling) ── */}
        <TopicTicker topics={topicStats} />

        {/* ── TWO-COLUMN BODY (desktop) ── */}
        <div style={isDesktop ? { display: 'flex', gap: 32, alignItems: 'flex-start' } : {}}>

          {/* ── LEFT COLUMN: Signal Feed ── */}
          <div style={isDesktop ? { flex: 1, minWidth: 0 } : {}}>

            {/* Feed tab bar */}
            <div style={{
              display: 'flex', gap: 6, marginBottom: 20,
              overflowX: 'auto', scrollbarWidth: 'none',
            }}>
              {FEED_TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => { setFeedTab(tab); setFeedPage(0); }}
                  className="type-label"
                  style={{
                    fontSize: 'var(--text-xs)',
                    letterSpacing: 'var(--tracking-wide)',
                    background: feedTab === tab ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                    color: feedTab === tab ? '#1a0a00' : 'var(--color-text-muted)',
                    border: feedTab === tab ? 'none' : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '6px 14px',
                    cursor: 'pointer',
                    transition: 'background 0.2s, color 0.2s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Signal cards */}
            {loading ? (
              <p className="type-data" style={{
                padding: '40px 0', textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
              }}>
                Scanning signals…
              </p>
            ) : filteredFeed.length === 0 ? (
              <p className="type-data" style={{
                padding: '40px 0', textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
              }}>
                No signals for this category yet.
              </p>
            ) : (
              <>
                {pagedFeed.map(post => (
                  <SignalCard key={post.id} post={post} />
                ))}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginTop: 16,
                  }}>
                    <button
                      onClick={() => setFeedPage(p => p - 1)}
                      disabled={feedPage === 0}
                      className="type-data"
                      style={{
                        fontSize: 'var(--text-xs)',
                        background: 'var(--color-bg-surface)',
                        color: feedPage === 0 ? 'var(--color-text-muted)' : 'var(--color-amber)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '6px 14px',
                        cursor: feedPage === 0 ? 'default' : 'pointer',
                        opacity: feedPage === 0 ? 0.4 : 1,
                      }}
                    >
                      ← PREV
                    </button>
                    <span className="type-data" style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 'var(--text-xs)',
                    }}>
                      {feedPage + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() => setFeedPage(p => p + 1)}
                      disabled={feedPage >= totalPages - 1}
                      className="type-data"
                      style={{
                        fontSize: 'var(--text-xs)',
                        background: 'var(--color-bg-surface)',
                        color: feedPage >= totalPages - 1 ? 'var(--color-text-muted)' : 'var(--color-amber)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '6px 14px',
                        cursor: feedPage >= totalPages - 1 ? 'default' : 'pointer',
                        opacity: feedPage >= totalPages - 1 ? 0.4 : 1,
                      }}
                    >
                      NEXT →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── RIGHT COLUMN: Intelligence Sidebar ── */}
          <div style={isDesktop ? { width: 340, flexShrink: 0 } : { marginTop: 32 }}>

            {/* Locality Activity + Rent */}
            <LocalityActivityCard localities={localityStats} rentData={rentData} navigate={navigate} />

            {/* Powered by */}
            <p className="type-data" style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
              opacity: 0.6,
            }}>
              Powered by Gemini ✦ Updated every 3h
            </p>
          </div>

        </div>{/* end two-column body */}
      </div>

      <BottomNav />
    </div>
  );
}
