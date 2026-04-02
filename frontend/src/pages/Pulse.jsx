import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import { supabase } from '../lib/supabase';

// ── Constants ─────────────────────────────────────────────────────────────────
const BHK_OPTIONS = ['1 BHK', '2 BHK', '3 BHK'];
const FEED_TABS = ['All', 'Reddit', 'Telegram', 'News'];
const SENTIMENT_TABS = ['All Sources', 'Reddit', 'News'];

const TIER_META = [
  { id: '01', label: 'Premium',    key: 'Premium'    },
  { id: '02', label: 'Mid-Range',  key: 'Mid-range'  },
  { id: '03', label: 'Affordable', key: 'Affordable' },
];

// Tier-specific colors matching LocalityGuide palette
const TIER_COLORS = {
  'Premium':    { bar: '#7C6AF5', label: '#7C6AF5', border: 'rgba(124,106,245,0.2)' },
  'Mid-Range':  { bar: '#60A5FA', label: '#60A5FA', border: 'rgba(96,165,250,0.2)'  },
  'Affordable': { bar: '#34D399', label: '#34D399', border: 'rgba(52,211,153,0.2)'  },
};

// How many rows to show per tier in collapsed state (total = 5)
const COLLAPSED_COUNTS = { 'Premium': 2, 'Mid-Range': 2, 'Affordable': 1 };

// ── Helpers ───────────────────────────────────────────────────────────────────
function localityToSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
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

function splitIntoTierGroups(localities) {
  const total = localities.length;
  if (total === 0) return { Premium: [], 'Mid-range': [], Affordable: [] };
  const premiumCount    = Math.max(1, Math.round(total * 0.3));
  const affordableCount = Math.max(1, Math.round(total * 0.3));
  const midCount        = total - premiumCount - affordableCount;
  return {
    Premium:     localities.slice(0, premiumCount),
    'Mid-range': localities.slice(premiumCount, premiumCount + midCount),
    Affordable:  localities.slice(premiumCount + midCount),
  };
}

function decodeHTML(str) {
  if (!str) return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

// ── Shared style objects ──────────────────────────────────────────────────────
const s = {
  page: {
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    minHeight: '100vh',
    paddingBottom: 100,
  },
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    color: 'var(--color-amber)',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  h2: {
    fontWeight: 300,
    fontSize: 20,
    letterSpacing: '-0.02em',
    marginBottom: 20,
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
};

// ── Sub-components ────────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      background: 'var(--color-bg-card)',
      color: 'var(--color-text-muted)',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
      padding: '3px 8px',
    }}>
      {source}
    </span>
  );
}

// Fix #3: body truncated to 2 lines, "Read more →" link shown after
function FeedCard({ item }) {
  return (
    <article style={{ ...s.card, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <SourceBadge source={item.source} />
        <span style={{ ...s.monoSmall }}>{item.channel}</span>
        <span style={{ ...s.monoSmall, marginLeft: 'auto' }}>{item.timeAgo}</span>
      </div>
      <h3 style={{ fontWeight: 300, fontSize: 15, lineHeight: 1.4, marginBottom: 8 }}>
        {item.title}
      </h3>
      <p style={{
        fontSize: 13,
        color: 'var(--color-text-muted)',
        lineHeight: 1.6,
        marginBottom: item.url ? 6 : 10,
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
            marginBottom: 10,
          }}
        >
          Read more →
        </a>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {item.tags.map(tag => (
          <span key={tag} style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'var(--color-amber)',
            opacity: 0.8,
          }}>
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function Pulse() {
  const navigate = useNavigate();

  const [selectedBhk,  setSelectedBhk]  = useState('2 BHK');
  const [showAll,      setShowAll]      = useState(false);
  const [feedTab,      setFeedTab]      = useState('All');
  const [feedPage,     setFeedPage]     = useState(0);
  const [sentimentTab, setSentimentTab] = useState('All Sources');

  const PAGE_SIZE = 5;

  // Locality + deposit data
  const [localityRows, setLocalityRows] = useState([]);
  const [depositRows,  setDepositRows]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [updatedAt,    setUpdatedAt]    = useState(null);

  // Feed + topic data
  const [feedPosts,   setFeedPosts]   = useState([]);
  const [rawTopics,   setRawTopics]   = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);

  // Fetch locality stats + deposit benchmarks on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [{ data: lData }, { data: dData }] = await Promise.all([
        supabase
          .from('locality_stats_cache')
          .select('*')
          .order('median_rent', { ascending: false }),
        supabase
          .from('deposit_stats_cache')
          .select('*')
          .order('bhk'),
      ]);
      if (cancelled) return;
      setLocalityRows(lData || []);
      setDepositRows(dData || []);
      if (lData && lData.length > 0) {
        const latest = lData.reduce((a, b) =>
          new Date(a.updated_at) > new Date(b.updated_at) ? a : b
        );
        setUpdatedAt(latest.updated_at);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Fetch locality feed (topics + posts) on mount
  useEffect(() => {
    let cancelled = false;
    async function loadFeed() {
      setFeedLoading(true);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: tData }, { data: pData }] = await Promise.all([
        supabase
          .from('locality_feed')
          .select('topic, source')
          .not('topic', 'is', null)
          .gte('scraped_at', thirtyDaysAgo),
        supabase
          .from('locality_feed')
          .select('id, source, author, locality, title, body, url, topic, sentiment, posted_at')
          .not('topic', 'is', null)
          .not('sentiment', 'is', null)
          .order('posted_at', { ascending: false })
          .limit(30),
      ]);
      if (cancelled) return;
      setRawTopics(tData || []);
      setFeedPosts(pData || []);
      setFeedLoading(false);
    }
    loadFeed();
    return () => { cancelled = true; };
  }, []);

  // ── Derived: localities for selected BHK ──────────────────────────────────
  const filteredLocalities = useMemo(
    () => localityRows.filter(r => r.bhk === selectedBhk),
    [localityRows, selectedBhk]
  );

  const maxRent = useMemo(
    () => filteredLocalities.length ? Math.max(...filteredLocalities.map(r => r.median_rent)) : 1,
    [filteredLocalities]
  );

  const tiers = useMemo(() => {
    const groups = splitIntoTierGroups(filteredLocalities);
    return TIER_META.map(meta => ({
      ...meta,
      localities: (groups[meta.key] || []).map(row => ({
        name:          row.locality,
        rent:          `₹${Number(row.median_rent).toLocaleString('en-IN')}/mo`,
        slug:          localityToSlug(row.locality),
        listingCount:  row.listing_count || 0,
        medianRent:    row.median_rent   || 0,
      })),
    }));
  }, [filteredLocalities]);

  // ── Derived: deposit benchmarks ──────────────────────────────────────────
  const deposits = useMemo(() => {
    return BHK_OPTIONS.map(bhk => {
      const d = depositRows.find(r => r.bhk === bhk);
      if (!d) return { config: bhk, multiplier: '—', range: '—' };
      return {
        config:     bhk,
        multiplier: `${Number(d.avg_multiplier).toFixed(1)}×`,
        range:      `≈ ₹${Number(d.median_deposit).toLocaleString('en-IN')}`,
      };
    });
  }, [depositRows]);

  // ── Derived: sentiment topic bars (filtered by tab, raw counts) ──────────
  const sentimentTopics = useMemo(() => {
    let src = rawTopics;
    if (sentimentTab === 'Reddit') src = rawTopics.filter(t => t.source === 'reddit');
    else if (sentimentTab === 'News') src = rawTopics.filter(t => t.source === 'news');

    const counts = {};
    for (const { topic } of src) {
      counts[topic] = (counts[topic] || 0) + 1;
    }
    const sorted = Object.entries(counts)
      .map(([label, count]) => ({
        label: label.charAt(0).toUpperCase() + label.slice(1),
        count,
      }))
      .filter(t => t.label.toLowerCase() !== 'other')
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    if (sorted.length === 0) return [];
    const maxCount = sorted[0].count;
    return sorted.map(t => ({ ...t, barPct: Math.round((t.count / maxCount) * 100) }));
  }, [rawTopics, sentimentTab]);

  // ── Derived: visible feed posts ──────────────────────────────────────────
  const visibleFeed = useMemo(() => {
    const srcLabel  = { reddit: 'Reddit', news: 'News', telegram: 'Telegram', nestiq: 'NestIQ' };
    const filterMap = { Reddit: 'reddit', Telegram: 'telegram', News: 'news' };

    let posts = feedPosts;
    if (feedTab !== 'All') {
      const src = filterMap[feedTab];
      posts = src ? feedPosts.filter(p => p.source === src) : [];
    }

    return posts.map(p => ({
      id:      p.id,
      source:  srcLabel[p.source] || p.source,
      channel: p.locality || p.author || '',
      timeAgo: timeAgoShort(p.posted_at),
      title:   p.title || '',
      body:    decodeHTML(p.body) || '',
      tags:    p.topic
        ? [`#${p.topic.charAt(0).toUpperCase() + p.topic.slice(1).replace(/\s+/g, '')}`]
        : [],
      url: p.url,
    }));
  }, [feedPosts, feedTab]);

  // BHK change resets showAll
  function handleBhkChange(bhk) {
    setSelectedBhk(bhk);
    setShowAll(false);
  }

  const isDesktop = useDesktop();

  return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, paddingBottom: isDesktop ? 40 : undefined }}>
      <DesktopSidebar />

      <AppHeader />

      <div style={{
        padding: isDesktop ? '24px 24px 0' : '24px 16px 0',
        maxWidth: isDesktop ? 1440 : undefined,
        margin: isDesktop ? '0 auto' : undefined,
      }}>

        {/* ── PAGE TITLE ── */}
        <h1 style={{
          fontWeight: 300, fontSize: 26, letterSpacing: '-0.025em',
          lineHeight: 1.2, marginBottom: 20,
        }}>
          Live rental intelligence<br />for Bangalore.
        </h1>

        {/* ── BHK SELECTOR ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 32 }}>
          {BHK_OPTIONS.map(bhk => (
            <button
              key={bhk}
              onClick={() => handleBhkChange(bhk)}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                background: selectedBhk === bhk ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                color: selectedBhk === bhk ? '#1a0a00' : 'var(--color-text-muted)',
                border: selectedBhk === bhk ? 'none' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-pill)', padding: '6px 14px', cursor: 'pointer',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {bhk}
            </button>
          ))}
        </div>

        {/* ── TWO-COLUMN BODY (desktop) ── */}
        <div style={isDesktop ? { display: 'flex', gap: 32, alignItems: 'flex-start' } : {}}>

        {/* ── LEFT COLUMN: Rent + Deposit ── */}
        <div style={isDesktop ? { width: 400, flexShrink: 0 } : {}}>

        {/* ── RENT BY LOCALITY ── */}
        <section style={{ marginBottom: 40 }}>
          {/* Section header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
                Average Rent
              </p>
              {updatedAt && (
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Updated {timeAgoLong(updatedAt)}
                </p>
              )}
            </div>
          </div>

          {/* Fix #1: LocalityGuide-style table card */}
          <div style={{
            background: 'var(--color-bg-surface)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}>
            {loading ? (
              <p style={{ ...s.monoSmall, padding: '20px 16px', opacity: 0.5 }}>Loading…</p>
            ) : filteredLocalities.length === 0 ? (
              <p style={{ ...s.monoSmall, padding: '20px 16px', opacity: 0.5 }}>
                No data available for {selectedBhk} yet.
              </p>
            ) : (
              <>
                {tiers.map(tier => {
                  const tc   = TIER_COLORS[tier.label];
                  const all  = tier.localities;
                  const rows = showAll ? all : all.slice(0, COLLAPSED_COUNTS[tier.label]);
                  if (rows.length === 0) return null;
                  return (
                    <div key={tier.id}>
                      {/* Tier label header */}
                      <div style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.08em', padding: '10px 16px 6px',
                        color: tc.label,
                        borderBottom: `1px solid ${tc.border}`,
                      }}>
                        {tier.label}
                      </div>

                      {/* Locality rows */}
                      {rows.map((loc, i) => (
                        <div
                          key={loc.slug}
                          style={{
                            padding: '11px 16px',
                            borderBottom: '1px solid var(--color-border)',
                            cursor: 'default',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-card)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                        >
                          {/* Row 1: name left · rent + explore right */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            marginBottom: 8,
                          }}>
                            {/* Name — never truncates */}
                            <div style={{
                              fontSize: 14, fontWeight: 500,
                              color: 'var(--color-text-primary)',
                            }}>
                              {loc.name}
                            </div>

                            {/* Rent + listing count + Explore button */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{
                                  fontSize: 13, fontWeight: 600,
                                  color: 'var(--color-text-primary)',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {loc.rent}
                                </div>
                                <div style={{
                                  fontSize: 10,
                                  color: 'var(--color-text-muted)',
                                  marginTop: 2,
                                }}>
                                  based on {loc.listingCount} listings
                                </div>
                              </div>

                              {/* Explore button */}
                              <button
                                onClick={() => navigate(`/neighbourhood-pulse/${loc.slug}`)}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 100,
                                  border: '1px solid var(--color-border)',
                                  background: 'var(--color-bg-surface)',
                                  color: 'var(--color-text-muted)',
                                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  transition: 'border-color 0.15s, color 0.15s',
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.borderColor = 'var(--color-amber)';
                                  e.currentTarget.style.color = 'var(--color-amber)';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.borderColor = 'var(--color-border)';
                                  e.currentTarget.style.color = 'var(--color-text-muted)';
                                }}
                              >
                                Explore
                              </button>
                            </div>{/* right-side flex: rent + explore */}
                          </div>{/* row 1: name + rent/explore */}

                          {/* Row 2: full-width progress bar */}
                          <div style={{
                            height: 4,
                            background: 'rgba(255,255,255,0.07)',
                            borderRadius: 3,
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              height: '100%',
                              borderRadius: 3,
                              width: `${(loc.medianRent / maxRent) * 100}%`,
                              background: tc.bar,
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {/* View all / collapse toggle */}
                {filteredLocalities.length > 5 && (
                  <button
                    onClick={() => setShowAll(v => !v)}
                    style={{
                      display: 'block', width: '100%', padding: '12px',
                      border: 'none', borderTop: '1px solid var(--color-border)',
                      background: 'var(--color-bg-surface)',
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-sans)', fontSize: 12,
                      cursor: 'pointer', textAlign: 'center',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--color-bg-card)';
                      e.currentTarget.style.color = 'var(--color-text-primary)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--color-bg-surface)';
                      e.currentTarget.style.color = 'var(--color-text-muted)';
                    }}
                  >
                    {showAll
                      ? 'Show less ↑'
                      : `View all ${filteredLocalities.length} localities ↓`}
                  </button>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── DEPOSIT BENCHMARKS ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={s.h2}>Security Deposit Benchmarks</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <p style={{ ...s.monoSmall, padding: '8px 0', opacity: 0.5 }}>Loading…</p>
            ) : (
              deposits.map(d => (
                <div key={d.config} style={{
                  ...s.card,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div>
                    <p style={{ ...s.monoSmall, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {d.config} Multiplier
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{d.range}</p>
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 500,
                    color: 'var(--color-amber)', letterSpacing: '-0.03em', lineHeight: 1,
                  }}>
                    {d.multiplier}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        </div>{/* end left column */}

        {/* ── RIGHT COLUMN: Sentiment + Feed ── */}
        <div style={isDesktop ? { flex: 1, minWidth: 0 } : {}}>

        {/* ── MARKET SENTIMENT ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={s.h2}>Market Sentiment</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            Aggregated real-time signals from social feeds and regional news outlets.
          </p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {SENTIMENT_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setSentimentTab(tab)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                  background: sentimentTab === tab ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                  color: sentimentTab === tab ? '#1a0a00' : 'var(--color-text-muted)',
                  border: sentimentTab === tab ? 'none' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-pill)', padding: '6px 14px', cursor: 'pointer',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ ...s.card }}>
            <p style={{ ...s.eyebrow, marginBottom: 16 }}>Volume by Topic</p>
            {feedLoading ? (
              <p style={{ ...s.monoSmall, opacity: 0.5 }}>Loading…</p>
            ) : sentimentTopics.length === 0 ? (
              <p style={{ ...s.monoSmall, opacity: 0.5 }}>No data available.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {sentimentTopics.map(t => (
                  <div key={t.label}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'baseline', marginBottom: 6,
                    }}>
                      <span style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        {t.label}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
                        color: 'var(--color-text-primary)',
                      }}>
                        {t.count}
                      </span>
                    </div>
                    {/* Progress bar proportional to count */}
                    <div style={{
                      height: 3, background: 'var(--color-border)',
                      borderRadius: 'var(--radius-pill)', overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', width: `${t.barPct}%`,
                        background: 'var(--color-amber)',
                        borderRadius: 'var(--radius-pill)',
                        opacity: 0.5 + (t.barPct / 200),
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── SOCIAL FEED ── */}
        <section style={{ marginBottom: 24 }}>
          {/* Feed tab bar */}
          <div style={{
            display: 'flex', gap: 6, marginBottom: 16,
            overflowX: 'auto', scrollbarWidth: 'none',
          }}>
            {FEED_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => { setFeedTab(tab); setFeedPage(0); }}
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

          {feedLoading ? (
            <p style={{ ...s.monoSmall, padding: '24px 0', textAlign: 'center', opacity: 0.5 }}>
              Loading signals…
            </p>
          ) : visibleFeed.length === 0 ? (
            <p style={{ ...s.monoSmall, padding: '24px 0', textAlign: 'center' }}>
              No signals for this source yet.
            </p>
          ) : (() => {
            const totalPages = Math.ceil(visibleFeed.length / PAGE_SIZE);
            const pagedFeed  = visibleFeed.slice(feedPage * PAGE_SIZE, (feedPage + 1) * PAGE_SIZE);
            return (
              <>
                {pagedFeed.map(item => <FeedCard key={item.id} item={item} />)}

                {totalPages > 1 && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginTop: 12,
                  }}>
                    <button
                      onClick={() => setFeedPage(p => p - 1)}
                      disabled={feedPage === 0}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                        background: 'var(--color-bg-surface)',
                        color: feedPage === 0 ? 'var(--color-text-muted)' : 'var(--color-amber)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-pill)', padding: '6px 14px',
                        cursor: feedPage === 0 ? 'default' : 'pointer',
                        opacity: feedPage === 0 ? 0.4 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      ← Prev
                    </button>

                    <span style={{ ...s.monoSmall }}>
                      {feedPage + 1} / {totalPages}
                    </span>

                    <button
                      onClick={() => setFeedPage(p => p + 1)}
                      disabled={feedPage >= totalPages - 1}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                        background: 'var(--color-bg-surface)',
                        color: feedPage >= totalPages - 1 ? 'var(--color-text-muted)' : 'var(--color-amber)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-pill)', padding: '6px 14px',
                        cursor: feedPage >= totalPages - 1 ? 'default' : 'pointer',
                        opacity: feedPage >= totalPages - 1 ? 0.4 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </section>

        </div>{/* end right column */}
        </div>{/* end two-column body */}

      </div>

      <BottomNav />
    </div>
  );
}
