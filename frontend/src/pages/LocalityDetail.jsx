import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTheme } from '../ThemeContext'
import Navbar from '../components/Navbar'
import { MobileNav } from '../components/MobileNav'
import { BackgroundPattern } from '../components/BackgroundPattern'
import { supabase } from '../lib/supabase'
import '../global.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugToLocality(slug) {
  // hsr-layout → HSR Layout, indiranagar → Indiranagar
  return slug
    .split('-')
    .map(w => w.toUpperCase() === w ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function localityToSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-')
}

function formatRent(n) {
  if (!n) return '—'
  return `₹${Number(n).toLocaleString('en-IN')}/mo`
}

function formatRentShort(n) {
  if (!n) return '—'
  const v = Number(n)
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`
  if (v >= 1000)   return `₹${(v / 1000).toFixed(0)}K`
  return `₹${v}`
}

function timeAgoFromDate(dateStr) {
  if (!dateStr) return null
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const hours  = Math.floor(diffMs / (1000 * 60 * 60))
  if (hours < 1)  return 'less than an hour ago'
  if (hours === 1) return '1 hour ago'
  if (hours < 24) return `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function decodeHTML(str) {
  if (!str) return str
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

// ── Feed constants (same as LocalityGuide) ────────────────────────────────────

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

const BHK_COLORS = { '1 BHK': '#34D399', '2 BHK': '#F5A623', '3 BHK': '#FF6060' }

// ── Skeleton helpers ──────────────────────────────────────────────────────────

function Skel({ w, h, radius = 4, style = {} }) {
  return (
    <div className="ld-skeleton" style={{ width: w, height: h, borderRadius: radius, ...style }} />
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div className="ld-stat-card">
      <div className="ld-stat-label">{label}</div>
      <div className="ld-stat-value">{value ?? '—'}</div>
      {sub && <div className="ld-stat-sub">{sub}</div>}
    </div>
  )
}

function TopicsBar({ topics, topicColorMap }) {
  const maxCount = topics.length > 0 ? topics[0].count : 1
  return (
    <div className="ld-topics-bar">
      <div className="ld-section-label" style={{ marginBottom: 14 }}>By topic</div>
      {topics.map(({ topic, count }) => {
        const color = topicColorMap[topic] || '#686670'
        const label = topic.charAt(0).toUpperCase() + topic.slice(1)
        const pct   = (count / maxCount) * 100
        return (
          <div key={topic} className="ld-topic-row">
            <div className="ld-topic-label">{label}</div>
            <div className="ld-topic-track">
              <div className="ld-topic-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="ld-topic-count" style={{ color }}>{count}</div>
          </div>
        )
      })}
      <div style={{
        marginTop: 14, paddingTop: 10,
        borderTop: '1px solid var(--ld-border)',
        display: 'flex', alignItems: 'center', gap: 5, opacity: 0.5,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontSize: 9, letterSpacing: '0.04em', color: 'var(--ld-muted)', whiteSpace: 'nowrap' }}>
          Powered by Gemini
        </span>
      </div>
    </div>
  )
}

function PostCard({ post, topicColorMap }) {
  const src        = SOURCE_STYLES[post.source] || { label: post.source, bg: '#1A1A22', color: '#686670' }
  const sent       = SENTIMENT_STYLES[post.sentiment] || SENTIMENT_STYLES.neutral
  const topicColor = topicColorMap[post.topic] || '#686670'
  const topicLabel = post.topic ? post.topic.charAt(0).toUpperCase() + post.topic.slice(1) : null

  return (
    <a href={post.url} target="_blank" rel="noopener noreferrer" className="ld-post-card">
      <div className="ld-post-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span className="ld-source-pill" style={{ background: src.bg, color: src.color }}>
            {src.label}
          </span>
          <span className="ld-post-author">{post.author}</span>
        </div>
        <span className="ld-post-time">{timeAgoFromDate(post.posted_at)}</span>
      </div>
      <div className="ld-post-title">{post.title}</div>
      {post.body && <div className="ld-post-body">{decodeHTML(post.body)}</div>}
      <div className="ld-post-bottom">
        {topicLabel && (
          <span className="ld-topic-tag" style={{ background: topicColor + '28', color: topicColor }}>
            {topicLabel}
          </span>
        )}
        <span className="ld-sentiment-tag" style={{ background: sent.bg, color: sent.color }}>
          {sent.label}
        </span>
      </div>
    </a>
  )
}

function NewsCard({ post, topicColorMap }) {
  const src        = SOURCE_STYLES[post.source] || { label: post.source, bg: '#1A1A22', color: '#686670' }
  const topicColor = topicColorMap[post.topic] || '#686670'
  const topicLabel = post.topic ? post.topic.charAt(0).toUpperCase() + post.topic.slice(1) : null

  return (
    <a href={post.url} target="_blank" rel="noopener noreferrer" className="ld-news-card">
      <div className="ld-post-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span className="ld-source-pill" style={{ background: src.bg, color: src.color }}>
            {src.label}
          </span>
        </div>
        <span className="ld-post-time" style={{ flexShrink: 0 }}>{timeAgoFromDate(post.posted_at)}</span>
      </div>
      <div className="ld-news-card-title">{post.title}</div>
      {post.body && <div className="ld-news-card-body">{decodeHTML(post.body)}</div>}
      <div className="ld-post-bottom">
        {topicLabel && (
          <span className="ld-topic-tag" style={{ background: topicColor + '28', color: topicColor }}>
            {topicLabel}
          </span>
        )}
        <span className="ld-post-time">{post.author}</span>
      </div>
    </a>
  )
}

function NewsCarousel({ posts, topicColorMap }) {
  const scrollRef = useRef(null)
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(posts.length > 2)

  function updateArrows() {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  function slide(dir) {
    scrollRef.current?.scrollBy({ left: dir * scrollRef.current.clientWidth, behavior: 'smooth' })
  }

  if (!posts.length) return null
  return (
    <div className="ld-carousel-outer">
      <button className="ld-carousel-arrow" onClick={() => slide(-1)} disabled={!canLeft} aria-label="Previous">‹</button>
      <div className="ld-carousel-track" ref={scrollRef} onScroll={updateArrows}>
        {posts.map(p => <NewsCard key={p.id} post={p} topicColorMap={topicColorMap} />)}
      </div>
      <button className="ld-carousel-arrow" onClick={() => slide(1)} disabled={!canRight} aria-label="Next">›</button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LocalityDetail() {
  const { locality: slug } = useParams()
  const navigate = useNavigate()
  const { theme } = useTheme()

  const locality = slugToLocality(slug)

  // ── State
  const [statsRows, setStatsRows]   = useState([])
  const [feedPosts, setFeedPosts]   = useState([])
  const [topicCounts, setTopicCounts] = useState([])
  const [loading, setLoading]       = useState(true)
  const [feedLoading, setFeedLoading] = useState(true)
  const [notFound, setNotFound]     = useState(false)
  const [feedFilter, setFeedFilter] = useState('All')
  const [feedShowAll, setFeedShowAll] = useState(false)

  // Set page title
  useEffect(() => {
    document.title = `${locality} — Neighbourhood Pulse | NestIQ`
    return () => { document.title = 'NestIQ' }
  }, [locality])

  // Fetch stats
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('locality_stats_cache')
        .select('bhk, median_rent, p25_rent, p75_rent, listing_count, updated_at')
        .eq('locality', locality)
        .order('bhk')
      if (cancelled) return
      if (!data || data.length === 0) {
        setNotFound(true)
      } else {
        setStatsRows(data)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [locality])

  // Redirect if not found after load
  useEffect(() => {
    if (notFound && !loading) {
      navigate('/locality-guide', { replace: true })
    }
  }, [notFound, loading, navigate])

  // Fetch feed
  useEffect(() => {
    let cancelled = false
    async function loadFeed() {
      setFeedLoading(true)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const [{ data: topicData }, { data: postsData }] = await Promise.all([
        supabase
          .from('locality_feed')
          .select('topic')
          .eq('locality', locality)
          .not('topic', 'is', null)
          .gte('scraped_at', thirtyDaysAgo),
        supabase
          .from('locality_feed')
          .select('id, source, author, locality, title, body, url, topic, sentiment, engagement, posted_at')
          .eq('locality', locality)
          .not('topic', 'is', null)
          .not('sentiment', 'is', null)
          .order('posted_at', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return

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
  }, [locality])

  // ── Derived
  const bhk2 = statsRows.find(r => r.bhk === '2 BHK')
  const totalListings = statsRows.reduce((s, r) => s + (r.listing_count || 0), 0)
  const updatedAt = statsRows.length
    ? statsRows.reduce((a, b) => new Date(a.updated_at) > new Date(b.updated_at) ? a : b).updated_at
    : null
  const maxRent = statsRows.length ? Math.max(...statsRows.map(r => r.median_rent)) : 1

  const topicColorMap = useMemo(() => {
    const map = {}
    topicCounts.forEach(({ topic }, i) => { map[topic] = PALETTE[i % PALETTE.length] })
    return map
  }, [topicCounts])

  const carouselPosts = useMemo(() => {
    const reddit = feedPosts.filter(p => p.source === 'reddit')
    const news   = feedPosts.filter(p => p.source === 'news')
    if (feedFilter === 'Reddit') return reddit
    if (feedFilter === 'News')   return news
    const result = []
    const len = Math.max(reddit.length, news.length)
    for (let i = 0; i < len; i++) {
      if (i < reddit.length) result.push(reddit[i])
      if (i < news.length)   result.push(news[i])
    }
    return result
  }, [feedPosts, feedFilter])

  const visibleCarouselPosts = useMemo(
    () => feedShowAll ? carouselPosts : carouselPosts.slice(0, 10),
    [carouselPosts, feedShowAll]
  )

  if (notFound) return null

  return (
    <div className="app-page">
      <style>{CSS}</style>
      <BackgroundPattern theme={theme} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar subtitle={locality} showAppCta />

        <main className="ld-main">
          <div className="ld-container">

            {/* Back link */}
            <Link to="/locality-guide" className="ld-back">
              ← Neighbourhood Pulse
            </Link>

            {/* ── Header ── */}
            {loading ? (
              <div className="ld-page-header">
                <Skel w={260} h={32} radius={6} style={{ marginBottom: 8 }} />
                <Skel w={180} h={14} radius={4} />
              </div>
            ) : (
              <div className="ld-page-header">
                <h1 className="ld-page-title">{locality}</h1>
                <p className="ld-page-subtitle">
                  {totalListings} active listings
                  {updatedAt && <> · Updated {timeAgoFromDate(updatedAt)}</>}
                </p>
              </div>
            )}

            {/* ── At a glance ── */}
            <section className="ld-section">
              <div className="ld-section-label">At a glance</div>
              <div className="ld-stat-grid">
                {loading ? (
                  [1,2].map(i => (
                    <div key={i} className="ld-stat-card">
                      <Skel w={80} h={10} style={{ marginBottom: 12 }} />
                      <Skel w={100} h={26} radius={6} style={{ marginBottom: 6 }} />
                      <Skel w={60} h={10} />
                    </div>
                  ))
                ) : (
                  <>
                    <StatCard
                      label="Avg 2BHK rent"
                      value={formatRent(bhk2?.median_rent)}
                      sub={bhk2 ? `based on ${bhk2.listing_count} listings` : null}
                    />
                    <StatCard
                      label="Total listings"
                      value={totalListings.toLocaleString('en-IN')}
                      sub="across all BHK types"
                    />
                  </>
                )}
              </div>
            </section>

            {/* ── Rent by BHK ── */}
            <section className="ld-section">
              <div className="ld-section-label">Rent by BHK</div>
              <div className="ld-card">
                {loading ? (
                  [1,2,3].map(i => (
                    <div key={i} className="ld-bhk-row">
                      <Skel w={48} h={14} />
                      <Skel w="60%" h={6} radius={3} />
                      <Skel w={80} h={14} />
                      <Skel w={90} h={12} />
                    </div>
                  ))
                ) : statsRows.length === 0 ? (
                  <div className="ld-empty">No rental data available for this area yet.</div>
                ) : (
                  statsRows.map(row => {
                    const color = BHK_COLORS[row.bhk] || '#686670'
                    const pct   = (row.median_rent / maxRent) * 100
                    return (
                      <div key={row.bhk} className="ld-bhk-row">
                        <div className="ld-bhk-label">{row.bhk}</div>
                        <div className="ld-bar-track">
                          <div className="ld-bar-fill" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <div className="ld-bhk-rent">{formatRent(row.median_rent)}</div>
                        <div className="ld-bhk-range">
                          {formatRentShort(row.p25_rent)} – {formatRentShort(row.p75_rent)}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>

            {/* ── What people are saying ── */}
            <section className="ld-section">
              <div className="ld-section-header">
                <div className="ld-section-label" style={{ marginBottom: 0 }}>
                  What people are saying about {locality}
                </div>
                {!feedLoading && feedPosts.length > 0 && (
                  <div className="ld-feed-filters" role="group">
                    {FEED_FILTERS.map(f => (
                      <button
                        key={f}
                        className={`ld-feed-filter-btn${feedFilter === f ? ' active' : ''}`}
                        onClick={() => { setFeedFilter(f); setFeedShowAll(false) }}
                      >{f}</button>
                    ))}
                  </div>
                )}
              </div>

              {feedLoading ? (
                <div className="ld-pulse-layout">
                  <div className="ld-topics-col">
                    <div className="ld-topics-bar">
                      <div className="ld-section-label" style={{ marginBottom: 14 }}>By topic</div>
                      {[80, 60, 45, 30].map((w, i) => (
                        <div key={i} className="ld-topic-row">
                          <Skel w="100%" h={12} />
                          <Skel w={`${w}%`} h={5} radius={3} />
                          <Skel w={18} h={12} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="ld-feed-col">
                    <div className="ld-carousel-outer">
                      <Skel w={28} h={28} radius={14} />
                      <div className="ld-carousel-track" style={{ overflow: 'hidden', flex: 1 }}>
                        {[1,2].map(i => (
                          <div key={i} className="ld-news-card" style={{ pointerEvents: 'none' }}>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                              <Skel w={52} h={20} radius={100} />
                              <Skel w={50} h={14} style={{ alignSelf: 'center' }} />
                            </div>
                            <Skel w="90%" h={14} style={{ marginBottom: 6 }} />
                            <Skel w="70%" h={14} style={{ marginBottom: 10 }} />
                            <Skel w="100%" h={11} style={{ marginBottom: 4 }} />
                            <Skel w="80%" h={11} />
                          </div>
                        ))}
                      </div>
                      <Skel w={28} h={28} radius={14} />
                    </div>
                  </div>
                </div>
              ) : feedPosts.length === 0 ? (
                <div className="ld-empty" style={{ border: '1px solid var(--ld-border)', borderRadius: 12 }}>
                  No local insights yet for this area. Check back tomorrow.
                </div>
              ) : (
                <div className="ld-pulse-layout">
                  {topicCounts.length > 0 && (
                    <div className="ld-topics-col">
                      <TopicsBar topics={topicCounts} topicColorMap={topicColorMap} />
                    </div>
                  )}
                  <div className={topicCounts.length > 0 ? 'ld-feed-col' : 'ld-feed-col-full'}>
                    {carouselPosts.length === 0 ? (
                      <div className="ld-empty" style={{ border: '1px solid var(--ld-border)', borderRadius: 12 }}>
                        No {feedFilter} posts yet.
                      </div>
                    ) : (
                      <NewsCarousel posts={visibleCarouselPosts} topicColorMap={topicColorMap} />
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
:root,
[data-theme="dark"] {
  --ld-surface:   #141418;
  --ld-surface2:  #1A1A22;
  --ld-surface3:  #1E1E28;
  --ld-border:    #22222C;
  --ld-border2:   #2C2C3A;
  --ld-text:      #E8E6E2;
  --ld-muted:     #686670;
  --ld-muted2:    #46444E;
  --ld-accent:    #7C6AF5;
  --ld-accent-bg: #16142A;
}

[data-theme="light"] {
  --ld-surface:   #ffffff;
  --ld-surface2:  #f6f8fa;
  --ld-surface3:  #edf0f3;
  --ld-border:    #e5e7eb;
  --ld-border2:   #d1d5db;
  --ld-text:      #111827;
  --ld-muted:     #6b7280;
  --ld-muted2:    #9ca3af;
  --ld-accent:    #5B4FD4;
  --ld-accent-bg: #eeecfb;
}

.ld-main {
  padding: 32px 20px 80px;
  min-height: calc(100vh - 57px);
}

.ld-container {
  max-width: 820px;
  margin: 0 auto;
}

/* Back link */
.ld-back {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--ld-muted);
  text-decoration: none;
  margin-bottom: 20px;
  transition: color 0.15s;
}
.ld-back:hover { color: var(--ld-text); }

/* Header */
.ld-page-header { margin-bottom: 32px; }
.ld-page-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--ld-text);
  margin: 0 0 6px;
  line-height: 1.2;
}
.ld-page-subtitle {
  font-size: 13px;
  color: var(--ld-muted);
  margin: 0;
}

/* Section */
.ld-section { margin-bottom: 40px; }
.ld-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.ld-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ld-muted2);
  margin-bottom: 12px;
}

/* Stat grid */
.ld-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.ld-stat-card {
  background: var(--ld-surface);
  border: 1px solid var(--ld-border);
  border-radius: 10px;
  padding: 16px;
}
.ld-stat-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ld-muted2);
  margin-bottom: 10px;
}
.ld-stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--ld-text);
  line-height: 1.2;
  margin-bottom: 4px;
}
.ld-stat-sub {
  font-size: 10px;
  color: var(--ld-muted);
}


/* Card */
.ld-card {
  background: var(--ld-surface);
  border: 1px solid var(--ld-border);
  border-radius: 12px;
  overflow: hidden;
}

/* BHK table rows */
.ld-bhk-row {
  display: grid;
  grid-template-columns: 52px 1fr 110px 100px;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ld-border);
}
.ld-bhk-row:last-child { border-bottom: none; }
.ld-bhk-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-text);
}
.ld-bar-track {
  height: 6px;
  background: var(--ld-surface2);
  border-radius: 3px;
  overflow: hidden;
}
.ld-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}
.ld-bhk-rent {
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-text);
  text-align: right;
}
.ld-bhk-range {
  font-size: 11px;
  color: var(--ld-muted);
  text-align: right;
}

/* Pulse two-column layout */
.ld-pulse-layout {
  display: flex;
  gap: 20px;
  align-items: stretch;
}
.ld-topics-col {
  width: 200px;
  flex-shrink: 0;
}
.ld-feed-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ld-feed-col-full {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Topics bar */
.ld-topics-bar {
  position: sticky;
  top: 24px;
  background: var(--ld-surface);
  border: 1px solid var(--ld-border);
  border-radius: 12px;
  padding: 16px;
}
.ld-topic-row {
  display: grid;
  grid-template-columns: 56px 1fr 22px;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.ld-topic-row:last-child { margin-bottom: 0; }
.ld-topic-label {
  font-size: 11px;
  color: var(--ld-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ld-topic-track {
  height: 5px;
  background: var(--ld-surface2);
  border-radius: 3px;
  overflow: hidden;
}
.ld-topic-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
.ld-topic-count { font-size: 11px; font-weight: 600; text-align: right; }

/* Feed filter tabs */
.ld-feed-filters {
  display: inline-flex;
  background: var(--ld-surface2);
  border-radius: 100px;
  padding: 3px;
  gap: 2px;
}
.ld-feed-filter-btn {
  border: none;
  border-radius: 100px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  color: var(--ld-muted);
  background: transparent;
  transition: background 0.15s, color 0.15s;
}
.ld-feed-filter-btn.active {
  background: var(--ld-surface);
  color: var(--ld-text);
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

/* Carousel */
.ld-carousel-outer {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  flex: 1;
}
.ld-carousel-track {
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
.ld-carousel-track::-webkit-scrollbar { display: none; }
.ld-carousel-arrow {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--ld-border2);
  background: var(--ld-surface2);
  color: var(--ld-text);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  padding: 0;
  align-self: center;
}
.ld-carousel-arrow:hover:not(:disabled) {
  background: var(--ld-surface3);
  border-color: var(--ld-accent);
}
.ld-carousel-arrow:disabled { opacity: 0.22; cursor: default; }

/* News card */
.ld-news-card {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: calc(50% - 5px);
  max-width: calc(50% - 5px);
  scroll-snap-align: start;
  background: var(--ld-surface);
  border: 1px solid var(--ld-border);
  border-radius: 10px;
  padding: 13px 14px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
  overflow: hidden;
}
.ld-news-card:hover {
  border-color: var(--ld-border2);
  box-shadow: 0 2px 10px rgba(0,0,0,0.2);
}
.ld-news-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-text);
  line-height: 1.4;
  margin: 7px 0 5px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex-shrink: 0;
}
.ld-news-card-body {
  font-size: 11px;
  color: var(--ld-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  margin-bottom: 8px;
}

/* Post card (used only if we add list view later) */
.ld-post-card {
  display: flex;
  flex-direction: column;
  background: var(--ld-surface);
  border: 1px solid var(--ld-border);
  border-radius: 10px;
  padding: 16px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, background 0.15s;
}
.ld-post-card:hover { border-color: var(--ld-border2); background: var(--ld-surface2); }

/* Shared post atoms */
.ld-post-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 9px;
  flex-wrap: wrap;
}
.ld-source-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 100px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}
.ld-post-author { font-size: 11px; color: var(--ld-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-post-time   { font-size: 11px; color: var(--ld-muted2); white-space: nowrap; flex-shrink: 0; }
.ld-post-title  { font-size: 13px; font-weight: 600; color: var(--ld-text); line-height: 1.4; margin-bottom: 6px; }
.ld-post-body {
  font-size: 12px; color: var(--ld-muted); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; text-overflow: ellipsis; margin-bottom: 10px; flex-shrink: 0;
}
.ld-post-bottom {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-top: auto; padding-top: 10px;
}
.ld-topic-tag {
  font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
}
.ld-sentiment-tag {
  font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
}

/* Skeleton */
.ld-skeleton {
  background: var(--ld-surface2);
  animation: pulse 1.5s ease-in-out infinite;
  display: block;
}
[data-theme="light"] .ld-skeleton { background: var(--ld-surface3); }

/* Empty */
.ld-empty {
  padding: 32px;
  text-align: center;
  color: var(--ld-muted);
  font-size: 13px;
}

/* Mobile */
@media (max-width: 600px) {
  .ld-main { padding: 20px 14px 80px; }
  .ld-page-title { font-size: 22px; }
  .ld-bhk-row { grid-template-columns: 48px 1fr 90px; }
  .ld-bhk-range { display: none; }
  .ld-pulse-layout { flex-direction: column; }
  .ld-topics-col { width: 100%; }
  .ld-topics-bar { position: static; }
  .ld-news-card {
    min-width: calc(100% - 0px);
    max-width: calc(100% - 0px);
    min-height: 150px;
  }
  .ld-section-header { flex-direction: column; align-items: flex-start; }
}
`
