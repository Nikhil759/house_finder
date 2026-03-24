import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext'
import Navbar from '../components/Navbar'
import { MobileNav } from '../components/MobileNav'
import { BackgroundPattern } from '../components/BackgroundPattern'
import { supabase } from '../lib/supabase'
import '../global.css'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRent(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}/mo`
}

function formatDeposit(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`
}

function decodeHTML(str) {
  if (!str) return str
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

function timeAgoFromDate(dateStr) {
  if (!dateStr) return null
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  if (hours < 1) return 'less than an hour ago'
  if (hours === 1) return '1 hour ago'
  if (hours < 24) return `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

// Split a sorted-desc locality list into three tier groups by count.
// Top 30% → Premium, middle 40% → Mid-range, bottom 30% → Affordable.
function splitIntoTierGroups(localities) {
  const total = localities.length
  if (total === 0) return { Premium: [], 'Mid-range': [], Affordable: [] }

  const premiumCount    = Math.round(total * 0.3)
  const affordableCount = Math.round(total * 0.3)
  const midCount        = total - premiumCount - affordableCount

  return {
    Premium:    localities.slice(0, premiumCount),
    'Mid-range':localities.slice(premiumCount, premiumCount + midCount),
    Affordable: localities.slice(premiumCount + midCount),
  }
}

// How many rows to show per tier in the collapsed state (total = 5)
const COLLAPSED_COUNTS = { Premium: 2, 'Mid-range': 2, Affordable: 1 }

const BHK_OPTIONS = ['1 BHK', '2 BHK', '3 BHK']

const TIER_CONFIG = {
  Premium:    { bar: 'var(--lg-accent)' },
  'Mid-range':{ bar: 'var(--lg-mid)'    },
  Affordable: { bar: 'var(--lg-aff)'    },
}

// ── Feed / Pulse constants ────────────────────────────────────────────────────

const PALETTE = ['#FF6060', '#5AAFFF', '#F5A623', '#7C6AF5', '#34C773', '#FF9040', '#686670']

const SOURCE_STYLES = {
  reddit: { label: 'Reddit', bg: '#281408', color: '#FF7040' },
  news:   { label: 'News',   bg: '#141428', color: '#9090E0' },
  nestiq: { label: 'NestIQ', bg: '#16142A', color: '#7C6AF5' },
}

const SENTIMENT_STYLES = {
  positive: { bg: '#0A1E12', color: '#34C773', label: 'Positive' },
  neutral:  { bg: '#1E1608', color: '#F5A623', label: 'Neutral'  },
  negative: { bg: '#1E0A0A', color: '#FF6060', label: 'Heads up' },
}

const FEED_FILTERS = ['All', 'Reddit', 'News']

// ── Sub-components ────────────────────────────────────────────────────────────

function TierGroupHeader({ tier }) {
  return (
    <div className={`lg-tier-header lg-tier-header--${tier.toLowerCase().replace('-', '')}`}>
      {tier}
    </div>
  )
}

function LocalityRow({ row, tier, barWidth, showBar }) {
  const tc = TIER_CONFIG[tier]
  const navigate = useNavigate()
  const slug = row.locality.toLowerCase().replace(/\s+/g, '-')
  return (
    <div
      className="lg-row"
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--lg-surface2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = '' }}
    >
      <div className="lg-locality-name">{row.locality}</div>
      <div className="lg-bar-track">
        <div
          className="lg-bar-fill"
          style={{ width: showBar ? `${barWidth}%` : '0%', background: tc.bar }}
        />
      </div>
      <div className="lg-rent-cell">
        <div className="lg-rent-value">{formatRent(row.median_rent)}</div>
        <div className="lg-listing-count">based on {row.listing_count} listings</div>
      </div>
      <button
        className="lg-explore-btn"
        onClick={() => navigate(`/neighbourhood-pulse/${slug}`)}
      >
        Explore
      </button>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="lg-row lg-skeleton-row">
      <div className="lg-skeleton" style={{ width: 100, height: 14, borderRadius: 4 }} />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="lg-skeleton" style={{ width: '65%', height: 6, borderRadius: 3 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <div className="lg-skeleton" style={{ width: 72, height: 14, borderRadius: 4 }} />
        <div className="lg-skeleton" style={{ width: 88, height: 10, borderRadius: 4 }} />
      </div>
      <div className="lg-skeleton" style={{ width: 56, height: 26, borderRadius: 100 }} />
    </div>
  )
}

function SkeletonDepositCard() {
  return (
    <div className="lg-deposit-card">
      <div className="lg-skeleton" style={{ width: 40, height: 10, borderRadius: 4, margin: '0 auto 10px' }} />
      <div className="lg-skeleton" style={{ width: 72, height: 34, borderRadius: 4, margin: '0 auto 8px' }} />
      <div className="lg-skeleton" style={{ width: 90, height: 12, borderRadius: 4, margin: '0 auto 4px' }} />
      <div className="lg-skeleton" style={{ width: 70, height: 10, borderRadius: 4, margin: '0 auto' }} />
    </div>
  )
}

function SkeletonPostCard() {
  return (
    <div className="lg-post-card" style={{ pointerEvents: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="lg-skeleton" style={{ width: 52, height: 20, borderRadius: 100 }} />
          <div className="lg-skeleton" style={{ width: 72, height: 14, borderRadius: 4, alignSelf: 'center' }} />
        </div>
        <div className="lg-skeleton" style={{ width: 48, height: 12, borderRadius: 4, alignSelf: 'center' }} />
      </div>
      <div className="lg-skeleton" style={{ width: '80%', height: 14, borderRadius: 4, marginBottom: 8 }} />
      <div className="lg-skeleton" style={{ width: '100%', height: 11, borderRadius: 4, marginBottom: 4 }} />
      <div className="lg-skeleton" style={{ width: '65%', height: 11, borderRadius: 4, marginBottom: 12 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="lg-skeleton" style={{ width: 52, height: 20, borderRadius: 4 }} />
        <div className="lg-skeleton" style={{ width: 58, height: 20, borderRadius: 4 }} />
      </div>
    </div>
  )
}

function TopicsBar({ topics, topicColorMap }) {
  const maxCount = topics.length > 0 ? topics[0].count : 1
  return (
    <div className="lg-topics-bar">
      <div className="lg-section-label" style={{ marginBottom: 14 }}>By topic</div>
      {topics.map(({ topic, count }) => {
        const color = topicColorMap[topic] || '#686670'
        const label = topic.charAt(0).toUpperCase() + topic.slice(1)
        const pct = (count / maxCount) * 100
        return (
          <div key={topic} className="lg-topic-row">
            <div className="lg-topic-label">{label}</div>
            <div className="lg-topic-track">
              <div className="lg-topic-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="lg-topic-count" style={{ color }}>{count}</div>
          </div>
        )
      })}
      <div style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: '1px solid var(--lg-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        opacity: 0.5,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontSize: 9, letterSpacing: '0.04em', color: 'var(--lg-muted)', whiteSpace: 'nowrap' }}>
          Powered by Gemini
        </span>
      </div>
    </div>
  )
}

function PostCard({ post, topicColorMap }) {
  const src  = SOURCE_STYLES[post.source]  || { label: post.source, bg: '#1A1A22', color: '#686670' }
  const sent = SENTIMENT_STYLES[post.sentiment] || SENTIMENT_STYLES.neutral
  const topicColor = topicColorMap[post.topic] || '#686670'
  const topicLabel = post.topic
    ? post.topic.charAt(0).toUpperCase() + post.topic.slice(1)
    : null

  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="lg-post-card"
    >
      <div className="lg-post-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span className="lg-source-pill" style={{ background: src.bg, color: src.color }}>
            {src.label}
          </span>
          <span className="lg-post-author">{post.author}</span>
          {post.locality && (
            <span className="lg-post-locality">· {post.locality}</span>
          )}
        </div>
        <span className="lg-post-time">{timeAgoFromDate(post.posted_at)}</span>
      </div>

      <div className="lg-post-title">{post.title}</div>

      {post.body && (
        <div className="lg-post-body">{decodeHTML(post.body)}</div>
      )}

      <div className="lg-post-bottom">
        {topicLabel && (
          <span
            className="lg-topic-tag"
            style={{ background: topicColor + '28', color: topicColor }}
          >
            {topicLabel}
          </span>
        )}
        <span className="lg-sentiment-tag" style={{ background: sent.bg, color: sent.color }}>
          {sent.label}
        </span>
      </div>
    </a>
  )
}

function NewsCard({ post, topicColorMap }) {
  const topicColor = topicColorMap[post.topic] || '#686670'
  const topicLabel = post.topic
    ? post.topic.charAt(0).toUpperCase() + post.topic.slice(1)
    : null
  const src = SOURCE_STYLES[post.source] || { label: post.source, bg: '#1A1A22', color: '#686670' }

  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="lg-news-card"
    >
      <div className="lg-post-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span className="lg-source-pill" style={{ background: src.bg, color: src.color }}>
            {src.label}
          </span>
          {post.locality && (
            <span className="lg-post-locality">{post.locality}</span>
          )}
        </div>
        <span className="lg-post-time" style={{ flexShrink: 0 }}>{timeAgoFromDate(post.posted_at)}</span>
      </div>

      <div className="lg-news-card-title">{post.title}</div>

      {post.body && (
        <div className="lg-news-card-body">{decodeHTML(post.body)}</div>
      )}

      <div className="lg-post-bottom">
        {topicLabel && (
          <span className="lg-topic-tag" style={{ background: topicColor + '28', color: topicColor }}>
            {topicLabel}
          </span>
        )}
        <span className="lg-post-time">{post.author}</span>
      </div>
    </a>
  )
}

function NewsCarousel({ newsPosts, topicColorMap }) {
  const scrollRef = useRef(null)
  const [canScrollLeft,  setCanScrollLeft]  = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(newsPosts.length > 2)

  function updateArrows() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  // Scroll by one visible page (exactly what's visible in the track)
  function slide(dir) {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' })
  }

  if (!newsPosts.length) return null

  return (
    <div className="lg-news-carousel-wrap">
      {/* Arrow + track + arrow in a single row */}
      <div className="lg-carousel-outer">
        <button
          className="lg-carousel-arrow"
          onClick={() => slide(-1)}
          disabled={!canScrollLeft}
          aria-label="Previous"
        >‹</button>

        <div
          className="lg-carousel-track"
          ref={scrollRef}
          onScroll={updateArrows}
        >
          {newsPosts.map(post => (
            <NewsCard key={post.id} post={post} topicColorMap={topicColorMap} />
          ))}
        </div>

        <button
          className="lg-carousel-arrow"
          onClick={() => slide(1)}
          disabled={!canScrollRight}
          aria-label="Next"
        >›</button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LocalityGuide() {
  const { theme } = useTheme()
  const [selectedBhk, setSelectedBhk] = useState('2 BHK')
  const [localityRows, setLocalityRows] = useState([])
  const [depositRows, setDepositRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [showBars, setShowBars] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Feed state
  const [feedPosts, setFeedPosts] = useState([])
  const [topicCounts, setTopicCounts] = useState([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedFilter, setFeedFilter] = useState('All')
  const [feedShowAll, setFeedShowAll] = useState(false)

  // Fetch both cache tables once on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: lData }, { data: dData }] = await Promise.all([
        supabase
          .from('locality_stats_cache')
          .select('*')
          .order('median_rent', { ascending: false }),
        supabase
          .from('deposit_stats_cache')
          .select('*')
          .order('bhk'),
      ])
      if (cancelled) return
      setLocalityRows(lData || [])
      setDepositRows(dData || [])
      if (lData && lData.length > 0) {
        // Use the most recently updated row as the cache timestamp
        const latest = lData.reduce((a, b) =>
          new Date(a.updated_at) > new Date(b.updated_at) ? a : b
        )
        setUpdatedAt(latest.updated_at)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Fetch locality feed (topics + posts)
  useEffect(() => {
    let cancelled = false
    async function loadFeed() {
      setFeedLoading(true)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const [{ data: topicData }, { data: postsData }] = await Promise.all([
        supabase
          .from('locality_feed')
          .select('topic')
          .not('topic', 'is', null)
          .gte('scraped_at', thirtyDaysAgo),
        supabase
          .from('locality_feed')
          .select('id, source, author, locality, title, body, url, topic, sentiment, engagement, posted_at')
          .not('topic', 'is', null)
          .not('sentiment', 'is', null)
          .order('posted_at', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return

      // Aggregate topic counts client-side — "other" always pinned last
      if (topicData) {
        const counts = {}
        for (const { topic } of topicData) {
          counts[topic] = (counts[topic] || 0) + 1
        }
        const sorted = Object.entries(counts)
          .map(([topic, count]) => ({ topic, count }))
          .sort((a, b) => {
            if (a.topic === 'other') return 1
            if (b.topic === 'other') return -1
            return b.count - a.count
          })
        setTopicCounts(sorted)
      }

      setFeedPosts(postsData || [])
      setFeedLoading(false)
    }
    loadFeed()
    return () => { cancelled = true }
  }, [])

  // Animate bars in after data loads
  useEffect(() => {
    if (!loading) {
      setShowBars(false)
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setShowBars(true))
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [loading])

  // Re-animate bars on BHK switch
  const handleBhkChange = useCallback((bhk) => {
    setSelectedBhk(bhk)
    setShowAll(false)
    setShowBars(false)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShowBars(true))
    })
  }, [])

  const filteredLocalities = useMemo(
    () => localityRows.filter(r => r.bhk === selectedBhk),
    [localityRows, selectedBhk]
  )

  const maxRent = useMemo(
    () => filteredLocalities.length ? Math.max(...filteredLocalities.map(r => r.median_rent)) : 1,
    [filteredLocalities]
  )

  const tierGroups = useMemo(
    () => splitIntoTierGroups(filteredLocalities),
    [filteredLocalities]
  )

  const TIER_ORDER = ['Premium', 'Mid-range', 'Affordable']

  // Assign colours by position in sorted topic list — keeps consistency across bar and cards
  const topicColorMap = useMemo(() => {
    const map = {}
    topicCounts.forEach(({ topic }, i) => {
      map[topic] = PALETTE[i % PALETTE.length]
    })
    return map
  }, [topicCounts])

  // Interleave Reddit and News for the carousel (Reddit, News, Reddit, News…)
  const carouselPosts = useMemo(() => {
    const reddit = feedPosts.filter(p => p.source === 'reddit')
    const news   = feedPosts.filter(p => p.source === 'news')
    if (feedFilter === 'Reddit') return reddit
    if (feedFilter === 'News')   return news
    // All: interleave
    const result = []
    const len = Math.max(reddit.length, news.length)
    for (let i = 0; i < len; i++) {
      if (i < reddit.length) result.push(reddit[i])
      if (i < news.length)   result.push(news[i])
    }
    return result
  }, [feedPosts, feedFilter])

  return (
    <div className="app-page">
      <style>{CSS}</style>
      <BackgroundPattern theme={theme} />

      <div style={{ position: 'relative', zIndex: 1 }}>
      <Navbar subtitle="Neighbourhood Pulse" showAppCta />

      <main className="lg-main">
        <div className="lg-container">

          {/* Page header */}
          <div className="lg-page-header">
            <h1 className="lg-page-title">Neighbourhood Pulse</h1>
            <p className="lg-page-subtitle">
              Live rental data and local insights across Bengaluru
            </p>
          </div>

          {/* ── Section 1: Average Rent ── */}
          <section className="lg-section">
            <div className="lg-section-header">
              <div>
                <div className="lg-section-label">Average rent</div>
                {updatedAt && (
                  <div className="lg-updated">Updated {timeAgoFromDate(updatedAt)}</div>
                )}
              </div>
              <div className="lg-bhk-toggle" role="group" aria-label="BHK filter">
                {BHK_OPTIONS.map(bhk => (
                  <button
                    key={bhk}
                    className={`lg-bhk-btn${selectedBhk === bhk ? ' active' : ''}`}
                    onClick={() => handleBhkChange(bhk)}
                    aria-pressed={selectedBhk === bhk}
                  >
                    {bhk}
                  </button>
                ))}
              </div>
            </div>

            <div className="lg-card">
              {loading ? (
                <>
                  <div className="lg-tier-header lg-tier-header--premium lg-skeleton-header" />
                  <SkeletonRow />
                  <SkeletonRow />
                  <div className="lg-tier-header lg-tier-header--midrange lg-skeleton-header" />
                  <SkeletonRow />
                  <SkeletonRow />
                  <div className="lg-tier-header lg-tier-header--affordable lg-skeleton-header" />
                  <SkeletonRow />
                </>
              ) : filteredLocalities.length === 0 ? (
                <div className="lg-empty">
                  No data available for {selectedBhk} yet.
                </div>
              ) : (
                <>
                  {TIER_ORDER.map(tier => {
                    const allRows = tierGroups[tier]
                    const rows = showAll
                      ? allRows
                      : allRows.slice(0, COLLAPSED_COUNTS[tier])
                    if (rows.length === 0) return null
                    return (
                      <div key={tier}>
                        <TierGroupHeader tier={tier} />
                        {rows.map(row => (
                          <LocalityRow
                            key={row.locality}
                            row={row}
                            tier={tier}
                            barWidth={(row.median_rent / maxRent) * 100}
                            showBar={showBars}
                          />
                        ))}
                      </div>
                    )
                  })}
                  {filteredLocalities.length > 5 && (
                    <button
                      className="lg-view-all"
                      onClick={() => setShowAll(v => !v)}
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

          {/* ── Section 2: Average Deposit ── */}
          <section className="lg-section">
            <div className="lg-section-label">Average deposit</div>
            <div className="lg-deposit-subtitle">
              What you'll need upfront before moving in
            </div>
            <div className="lg-deposit-grid">
              {loading ? (
                BHK_OPTIONS.map(bhk => <SkeletonDepositCard key={bhk} />)
              ) : depositRows.length === 0 ? (
                <div className="lg-empty" style={{ gridColumn: '1 / -1' }}>
                  No deposit data available.
                </div>
              ) : (
                BHK_OPTIONS.map(bhk => {
                  const d = depositRows.find(r => r.bhk === bhk)
                  if (!d) {
                    return (
                      <div key={bhk} className="lg-deposit-card">
                        <div className="lg-deposit-bhk">{bhk}</div>
                        <div className="lg-deposit-empty">No data</div>
                      </div>
                    )
                  }
                  return (
                    <div key={bhk} className="lg-deposit-card">
                      <div className="lg-deposit-bhk">{bhk}</div>
                      <div className="lg-deposit-multiplier">
                        <span className="lg-deposit-num">
                          {Number(d.avg_multiplier).toFixed(1)}×
                        </span>
                        <span className="lg-deposit-rent-label">rent</span>
                      </div>
                      <div className="lg-deposit-amount">
                        ≈ {formatDeposit(d.median_deposit)}
                      </div>
                      <div className="lg-deposit-label">median deposit</div>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          {/* ── Section 3: What people are saying ── */}
          <section className="lg-section">
            {/* Section label + filter tabs on the same row */}
            <div className="lg-section-header" style={{ marginBottom: 16 }}>
              <div className="lg-section-label" style={{ marginBottom: 0 }}>
                What people are saying
              </div>
              {!feedLoading && feedPosts.length > 0 && (
                <div className="lg-feed-filters" role="group" aria-label="Source filter">
                  {FEED_FILTERS.map(f => (
                    <button
                      key={f}
                      className={`lg-feed-filter-btn${feedFilter === f ? ' active' : ''}`}
                      onClick={() => { setFeedFilter(f); setFeedShowAll(false) }}
                      aria-pressed={feedFilter === f}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {feedLoading ? (
              <div className="lg-pulse-layout">
                {/* Topics skeleton */}
                <div className="lg-topics-col">
                  <div className="lg-topics-bar">
                    <div className="lg-section-label" style={{ marginBottom: 14 }}>By topic</div>
                    {[80, 65, 50, 40, 30].map((w, i) => (
                      <div key={i} className="lg-topic-row">
                        <div className="lg-skeleton" style={{ width: '100%', height: 12, borderRadius: 4 }} />
                        <div className="lg-skeleton" style={{ width: `${w}%`, height: 5, borderRadius: 3 }} />
                        <div className="lg-skeleton" style={{ width: 18, height: 12, borderRadius: 4 }} />
                      </div>
                    ))}
                  </div>
                </div>
                {/* Carousel skeleton */}
                <div className="lg-feed-col">
                  <div className="lg-carousel-track" style={{ overflow: 'hidden' }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} className="lg-news-card" style={{ pointerEvents: 'none' }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <div className="lg-skeleton" style={{ width: 52, height: 20, borderRadius: 100 }} />
                          <div className="lg-skeleton" style={{ width: 60, height: 14, borderRadius: 4, alignSelf: 'center' }} />
                        </div>
                        <div className="lg-skeleton" style={{ width: '90%', height: 14, borderRadius: 4, marginBottom: 6 }} />
                        <div className="lg-skeleton" style={{ width: '70%', height: 14, borderRadius: 4, marginBottom: 10 }} />
                        <div className="lg-skeleton" style={{ width: '100%', height: 11, borderRadius: 4, marginBottom: 4 }} />
                        <div className="lg-skeleton" style={{ width: '80%', height: 11, borderRadius: 4 }} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : feedPosts.length === 0 ? (
              <div className="lg-empty" style={{ border: '1px solid var(--lg-border)', borderRadius: 12 }}>
                Local insights are being collected. Check back tomorrow.
              </div>
            ) : (
              <div className="lg-pulse-layout">
                {/* Left: topics bar */}
                <div className="lg-topics-col">
                  <TopicsBar topics={topicCounts} topicColorMap={topicColorMap} />
                </div>

                {/* Right: unified carousel (news + reddit) */}
                <div className="lg-feed-col">
                  {carouselPosts.length === 0 ? (
                    <div className="lg-empty" style={{ border: '1px solid var(--lg-border)', borderRadius: 12 }}>
                      No posts yet. Check back soon.
                    </div>
                  ) : (
                    <NewsCarousel newsPosts={carouselPosts} topicColorMap={topicColorMap} />
                  )}
                </div>
              </div>
            )}
          </section>

        </div>
      </main>

      <MobileNav />
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
/* Design-system variables scoped to lg- components */
:root,
[data-theme="dark"] {
  --lg-surface:    #141418;
  --lg-surface2:   #1A1A22;
  --lg-surface3:   #1E1E28;
  --lg-border:     #22222C;
  --lg-border2:    #2C2C3A;
  --lg-text:       #E8E6E2;
  --lg-muted:      #686670;
  --lg-muted2:     #46444E;
  --lg-accent:     #7C6AF5;   /* violet  — Premium   */
  --lg-accent-bg:  #16142A;
  --lg-mid:        #60A5FA;   /* blue    — Mid-range */
  --lg-aff:        #34D399;   /* emerald — Affordable */
}

[data-theme="light"] {
  --lg-surface:    #ffffff;
  --lg-surface2:   #f6f8fa;
  --lg-surface3:   #edf0f3;
  --lg-border:     #e5e7eb;
  --lg-border2:    #d1d5db;
  --lg-text:       #111827;
  --lg-muted:      #6b7280;
  --lg-muted2:     #9ca3af;
  --lg-accent:     #5B4FD4;
  --lg-accent-bg:  #eeecfb;
  --lg-mid:        #2563EB;
  --lg-aff:        #059669;
}

/* ── Page layout ── */
.lg-main {
  padding: 40px 20px 60px;
  min-height: calc(100vh - 57px);
}

.lg-container {
  max-width: 820px;
  margin: 0 auto;
}

.lg-page-header {
  margin-bottom: 36px;
}

.lg-page-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--lg-text);
  margin: 0 0 6px;
  line-height: 1.2;
}

.lg-page-subtitle {
  font-size: 13px;
  color: var(--lg-muted);
  margin: 0;
}

/* ── Sections ── */
.lg-section {
  margin-bottom: 44px;
}

.lg-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.lg-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lg-muted2);
  margin-bottom: 3px;
}

.lg-updated {
  font-size: 11px;
  color: var(--lg-muted);
}

/* ── BHK Toggle ── */
.lg-bhk-toggle {
  display: inline-flex;
  background: var(--lg-surface2);
  border-radius: 100px;
  padding: 3px;
  gap: 2px;
  flex-shrink: 0;
}

.lg-bhk-btn {
  border: none;
  border-radius: 100px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  color: var(--lg-muted);
  background: transparent;
  white-space: nowrap;
}

.lg-bhk-btn.active {
  background: var(--lg-surface);
  color: var(--lg-text);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

/* ── Bar card ── */
.lg-card {
  background: var(--lg-surface);
  border: 1px solid var(--lg-border);
  border-radius: 12px;
  overflow: hidden;
}

/* ── Tier group headers ── */
.lg-tier-header {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 10px 16px 6px;
  border-bottom: 1px solid transparent;
}

.lg-tier-header--premium {
  color: var(--lg-accent);
  border-bottom-color: rgba(124, 106, 245, 0.2);
}
[data-theme="light"] .lg-tier-header--premium {
  border-bottom-color: rgba(91, 79, 212, 0.2);
}

.lg-tier-header--midrange {
  color: var(--lg-mid);
  border-bottom-color: rgba(96, 165, 250, 0.2);
}
[data-theme="light"] .lg-tier-header--midrange {
  border-bottom-color: rgba(37, 99, 235, 0.2);
}

.lg-tier-header--affordable {
  color: var(--lg-aff);
  border-bottom-color: rgba(52, 211, 153, 0.2);
}
[data-theme="light"] .lg-tier-header--affordable {
  border-bottom-color: rgba(5, 150, 105, 0.2);
}

.lg-skeleton-header {
  height: 32px;
  background: var(--lg-surface);
  animation: none;
  border-bottom-color: var(--lg-border) !important;
  color: transparent;
  user-select: none;
}

/* ── Locality row (4 columns: name | bar | rent | explore) ── */
.lg-row {
  display: grid;
  grid-template-columns: 130px 1fr 110px auto;
  gap: 12px;
  align-items: center;
  padding: 11px 16px;
  border-bottom: 1px solid var(--lg-border);
  transition: background 0.15s;
  cursor: default;
}

.lg-row:last-child {
  border-bottom: none;
}

.lg-locality-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--lg-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lg-bar-track {
  height: 6px;
  background: var(--lg-surface2);
  border-radius: 3px;
  overflow: hidden;
}

.lg-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
  will-change: width;
}

.lg-rent-cell {
  text-align: right;
}

.lg-rent-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--lg-text);
  white-space: nowrap;
}

.lg-listing-count {
  font-size: 10px;
  color: var(--lg-muted2);
  margin-top: 2px;
  white-space: nowrap;
}

.lg-explore-btn {
  padding: 4px 10px;
  border-radius: 100px;
  border: 1px solid var(--lg-border2);
  background: var(--lg-surface2);
  color: var(--lg-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.lg-explore-btn:hover {
  background: var(--lg-accent-bg);
  border-color: var(--lg-accent);
  color: var(--lg-accent);
}

/* ── View all button ── */
.lg-view-all {
  display: block;
  width: 100%;
  padding: 12px;
  border: none;
  border-top: 1px solid var(--lg-border);
  border-radius: 0 0 12px 12px;
  background: var(--lg-surface);
  color: var(--lg-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  text-align: center;
}

.lg-view-all:hover {
  background: var(--lg-surface2);
  color: var(--lg-text);
}

/* ── Deposit section ── */
.lg-deposit-subtitle {
  font-size: 12px;
  color: var(--lg-muted);
  margin-top: 4px;
  margin-bottom: 12px;
}

.lg-deposit-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.lg-deposit-card {
  background: var(--lg-surface2);
  border: 1px solid var(--lg-border);
  border-radius: 8px;
  padding: 18px 16px 16px;
  text-align: center;
}

.lg-deposit-bhk {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lg-muted2);
  margin-bottom: 10px;
}

.lg-deposit-multiplier {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  margin-bottom: 8px;
}

.lg-deposit-num {
  font-size: 28px;
  font-weight: 300;
  color: var(--lg-text);
  line-height: 1;
}

.lg-deposit-rent-label {
  font-size: 13px;
  color: var(--lg-muted);
}

.lg-deposit-amount {
  font-size: 13px;
  font-weight: 500;
  color: var(--lg-text);
  margin-bottom: 2px;
}

.lg-deposit-label {
  font-size: 10px;
  color: var(--lg-muted2);
}

.lg-deposit-empty {
  font-size: 12px;
  color: var(--lg-muted);
  padding: 12px 0;
}

/* ── Skeleton loader ── */
.lg-skeleton {
  background: var(--lg-surface2);
  animation: pulse 1.5s ease-in-out infinite;
}

[data-theme="light"] .lg-skeleton {
  background: var(--lg-surface3);
}

.lg-skeleton-row {
  pointer-events: none;
}

/* ── Empty state ── */
.lg-empty {
  padding: 32px;
  text-align: center;
  color: var(--lg-muted);
  font-size: 13px;
}

/* ── Mobile responsive ── */
@media (max-width: 600px) {
  .lg-main {
    padding: 24px 14px 80px;
  }

  .lg-page-title {
    font-size: 22px;
  }

  .lg-tier-header {
    padding: 9px 14px 5px;
  }

  .lg-row {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto auto;
    row-gap: 8px;
    column-gap: 10px;
    padding: 12px 14px;
  }

  .lg-locality-name {
    grid-column: 1;
    grid-row: 1;
  }

  .lg-bar-track {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .lg-rent-cell {
    grid-column: 1;
    grid-row: 3;
    text-align: left;
  }

  .lg-explore-btn {
    grid-column: 2;
    grid-row: 3;
    align-self: center;
  }

  .lg-deposit-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .lg-section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}

@media (max-width: 420px) {
  .lg-bhk-btn {
    padding: 5px 10px;
    font-size: 11px;
  }
}

/* ── Pulse section layout ── */
.lg-pulse-layout {
  display: flex;
  gap: 20px;
  align-items: stretch;
}

.lg-topics-col {
  width: 220px;
  flex-shrink: 0;
}

.lg-feed-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* ── Topics bar (left column) ── */
.lg-topics-bar {
  position: sticky;
  top: 24px;
  background: var(--lg-surface);
  border: 1px solid var(--lg-border);
  border-radius: 12px;
  padding: 16px;
}

.lg-topic-row {
  display: grid;
  grid-template-columns: 62px 1fr 24px;
  align-items: center;
  gap: 8px;
  margin-bottom: 11px;
}

.lg-topic-row:last-child {
  margin-bottom: 0;
}

.lg-topic-label {
  font-size: 12px;
  color: var(--lg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lg-topic-track {
  height: 5px;
  background: var(--lg-surface2);
  border-radius: 3px;
  overflow: hidden;
}

.lg-topic-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.lg-topic-count {
  font-size: 11px;
  font-weight: 600;
  text-align: right;
}

/* ── Feed filter tabs ── */
.lg-feed-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.lg-feed-filters {
  display: inline-flex;
  background: var(--lg-surface2);
  border-radius: 100px;
  padding: 3px;
  gap: 2px;
}

.lg-feed-filter-btn {
  border: none;
  border-radius: 100px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  color: var(--lg-muted);
  background: transparent;
  white-space: nowrap;
}

.lg-feed-filter-btn.active {
  background: var(--lg-surface);
  color: var(--lg-text);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

/* ── Post cards ── */
.lg-feed-posts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lg-post-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  background: var(--lg-surface);
  border: 1px solid var(--lg-border);
  border-radius: 10px;
  padding: 16px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, background 0.15s;
  cursor: pointer;
}

.lg-post-card:hover {
  border-color: var(--lg-border2);
  background: var(--lg-surface2);
}

.lg-post-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 9px;
  flex-wrap: wrap;
}

.lg-source-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 100px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.lg-post-author {
  font-size: 11px;
  color: var(--lg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lg-post-locality {
  font-size: 11px;
  color: var(--lg-muted2);
  white-space: nowrap;
}

.lg-post-time {
  font-size: 11px;
  color: var(--lg-muted2);
  white-space: nowrap;
  flex-shrink: 0;
}

.lg-post-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--lg-text);
  line-height: 1.4;
  margin-bottom: 6px;
}

.lg-post-body {
  font-size: 12px;
  color: var(--lg-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.lg-post-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
}

.lg-topic-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.lg-sentiment-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.lg-show-more-btn {
  display: block;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--lg-border);
  border-radius: 10px;
  background: var(--lg-surface);
  color: var(--lg-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  text-align: center;
  margin-top: 10px;
}

.lg-show-more-btn:hover {
  background: var(--lg-surface2);
  color: var(--lg-text);
}

@media (max-width: 600px) {
  .lg-pulse-layout {
    flex-direction: column;
  }

  .lg-topics-col {
    width: 100%;
  }

  .lg-topics-bar {
    position: static;
  }

  .lg-topic-row {
    grid-template-columns: 58px 1fr 22px;
  }
}

/* ── News carousel — stretches to match sidebar height ── */
.lg-news-carousel-wrap {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Arrow + track in a single flex row */
.lg-carousel-outer {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  flex: 1;
}

.lg-carousel-track {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: 4px 0 8px;
}

.lg-carousel-track::-webkit-scrollbar {
  display: none;
}

/* ── Arrow buttons — inline, not absolute ── */
.lg-carousel-arrow {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--lg-border2);
  background: var(--lg-surface2);
  color: var(--lg-text);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  padding: 0;
  align-self: center;
  margin-top: 4px;
}

.lg-carousel-arrow:hover:not(:disabled) {
  background: var(--lg-surface3);
  border-color: var(--lg-accent);
}

.lg-carousel-arrow:disabled {
  opacity: 0.22;
  cursor: default;
}

/* ── News card — fills 50% of track (2 visible), height matches sidebar ── */
.lg-news-card {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  /* Show 2 cards at a time: half track width minus half the gap */
  min-width: calc(50% - 5px);
  max-width: calc(50% - 5px);
  scroll-snap-align: start;
  background: var(--lg-surface);
  border: 1px solid var(--lg-border);
  border-radius: 10px;
  padding: 13px 14px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
  overflow: hidden;
}

.lg-news-card:hover {
  border-color: var(--lg-border2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.lg-news-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--lg-text);
  line-height: 1.4;
  margin: 7px 0 5px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex-shrink: 0;
}

.lg-news-card-body {
  font-size: 11px;
  color: var(--lg-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  margin-bottom: 8px;
}

@media (max-width: 600px) {
  .lg-news-card {
    /* 1 card visible on mobile */
    min-width: calc(100% - 0px);
    max-width: calc(100% - 0px);
    height: auto;
    min-height: 150px;
  }
}
`
