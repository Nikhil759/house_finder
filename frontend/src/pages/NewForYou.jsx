import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext'
import { useAuth } from '../hooks/useAuth'
import { useSavedSearches } from '../hooks/useSavedSearches'
import { useNewListings } from '../hooks/useNewListings'
import { AuthButton } from '../components/AuthButton'
import { BackgroundPattern } from '../components/BackgroundPattern'
import Navbar from '../components/Navbar'
import '../global.css'

const SOURCE_COLORS = {
  reddit:   '#ff4500',
  telegram: '#229ed9',
  nobroker: '#e63946',
  housing:  '#7c3aed',
}

function timeAgo(ts) {
  if (!ts) return ''
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function MiniCard({ post }) {
  const source  = post.source || 'reddit'
  const color   = SOURCE_COLORS[source] || '#888'
  const created = post.created || post.created_utc || 0

  const url = post.url || post.permalink
    ? (post.url || `https://reddit.com${post.permalink}`)
    : null

  return (
    <a
      href={url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '14px 16px',
        textDecoration: 'none',
        transition: 'border-color 0.2s, transform 0.15s',
        cursor: url ? 'pointer' : 'default',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = color
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.transform = 'none'
      }}
    >
      {/* Source + time row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      }}>
        <span style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }} />
        <span style={{ fontSize: '11px', color, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {source}
        </span>
        {post.quality_score != null && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '11px',
            fontWeight: '700',
            color: post.quality_score >= 60 ? '#4ade80' : post.quality_score >= 40 ? '#f5a623' : 'var(--text-muted)',
            background: post.quality_score >= 60 ? 'rgba(74,222,128,0.1)' : post.quality_score >= 40 ? 'rgba(245,166,35,0.1)' : 'var(--bg-secondary)',
            border: `1px solid ${post.quality_score >= 60 ? 'rgba(74,222,128,0.25)' : post.quality_score >= 40 ? 'rgba(245,166,35,0.25)' : 'var(--border)'}`,
            borderRadius: '4px',
            padding: '1px 6px',
          }}>
            {post.quality_score}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: '13px',
        fontWeight: '500',
        color: 'var(--text-primary)',
        lineHeight: '1.4',
        marginBottom: '10px',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {post.title}
      </div>

      {/* Pills row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {(post.bhk) && (
          <span style={pillStyle}>{post.bhk}</span>
        )}
        {(post.locality) && (
          <span style={pillStyle}>{post.locality}</span>
        )}
        {(post.price || post.price_formatted) && (
          <span style={{ ...pillStyle, color: '#f5a623', borderColor: 'rgba(245,166,35,0.3)', background: 'rgba(245,166,35,0.08)' }}>
            {post.price_formatted || `₹${(post.price || 0).toLocaleString()}`}
          </span>
        )}
        {post.furnishing && (
          <span style={pillStyle}>{post.furnishing}</span>
        )}
        {created > 0 && (
          <span style={{ ...pillStyle, marginLeft: 'auto' }}>{timeAgo(created)}</span>
        )}
      </div>
    </a>
  )
}

const pillStyle = {
  fontSize: '11px',
  padding: '2px 8px',
  borderRadius: '4px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
}

export default function NewForYou() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { user } = useAuth()
  const { savedSearches } = useSavedSearches(user)
  const { newListings, totalCount, loading, markAllSeen } =
    useNewListings(user, savedSearches)

  // Auto-mark all seen after 5 seconds on this page
  useEffect(() => {
    if (Object.keys(newListings).length === 0) return
    const timer = setTimeout(markAllSeen, 5000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newListings])

  if (!user) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '24px',
      }}>
        <i className="fa-regular fa-bell" style={{ fontSize: '40px', color: '#f5a623' }} />
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '22px' }}>
          New For You
        </h2>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0, fontSize: '14px' }}>
          Sign in to see new listings matching your saved searches
        </p>
        <AuthButton />
      </div>
    )
  }

  return (
    <div className="app-page">
      <BackgroundPattern theme={theme} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar />

        <div style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: '32px 24px',
        }}>

          {/* Page header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '32px',
            flexWrap: 'wrap',
            gap: '12px',
          }}>
            <div>
              <h1 style={{
                color: 'var(--text-primary)',
                fontSize: '20px',
                fontWeight: '700',
                margin: '0 0 4px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <i className="fa-regular fa-bell" style={{ color: '#f5a623', fontSize: '18px' }} />
                New For You
              </h1>
              <p style={{
                color: 'var(--text-muted)',
                fontSize: '13px',
                margin: 0,
              }}>
                {loading
                  ? 'Checking your saved searches...'
                  : totalCount > 0
                    ? `${totalCount} new ${totalCount === 1 ? 'listing' : 'listings'} since your last search`
                    : 'No new listings since your last search'}
              </p>
            </div>
            {!loading && totalCount > 0 && (
              <button
                onClick={markAllSeen}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '7px 14px',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Mark all seen
              </button>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div style={{
              textAlign: 'center',
              padding: '80px 0',
              color: 'var(--text-muted)',
              fontSize: '14px',
            }}>
              Scanning your saved searches...
            </div>
          )}

          {/* No saved searches */}
          {!loading && savedSearches.length === 0 && (
            <div style={{
              textAlign: 'center',
              padding: '80px 0',
              color: 'var(--text-muted)',
            }}>
              <i className="fa-regular fa-magnifying-glass" style={{ fontSize: '40px', color: 'var(--text-muted)', marginBottom: '16px', display: 'block' }} />
              <p style={{ fontSize: '14px', marginBottom: '20px' }}>
                Save a search first to see new listings here
              </p>
              <button
                onClick={() => navigate('/app')}
                style={{
                  background: '#f5a623',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 24px',
                  color: '#000',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Start searching →
              </button>
            </div>
          )}

          {/* All caught up */}
          {!loading && savedSearches.length > 0 && totalCount === 0 && (
            <div style={{
              textAlign: 'center',
              padding: '80px 0',
              color: 'var(--text-muted)',
            }}>
              <i className="fa-regular fa-circle-check" style={{ fontSize: '40px', color: '#4ade80', marginBottom: '16px', display: 'block' }} />
              <p style={{ fontSize: '14px' }}>
                You're all caught up — no new homes since your last search
              </p>
              <button
                onClick={() => navigate('/app')}
                style={{
                  marginTop: '12px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '8px 20px',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Search again →
              </button>
            </div>
          )}

          {/* Listings grouped by saved search */}
          {!loading && Object.values(newListings).map(({ search, listings }) => (
            <div key={search.id} style={{ marginBottom: '48px' }}>

              {/* Group header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border)',
              }}>
                <div>
                  <span style={{
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    fontSize: '15px',
                  }}>
                    {search.name}
                  </span>
                  <span style={{
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    marginLeft: '10px',
                  }}>
                    {listings.length} new
                  </span>
                </div>
                <button
                  onClick={() => {
                    const params = new URLSearchParams()
                    if (search.location) params.set('location', search.location)
                    if (search.bhk)      params.set('bhk', search.bhk)
                    if (search.budget)   params.set('budget', search.budget)
                    navigate(`/app?${params}`)
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  View all →
                </button>
              </div>

              {/* Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '16px',
              }}>
                {listings.map(listing => (
                  <MiniCard key={listing.id} post={listing} />
                ))}
              </div>
            </div>
          ))}

        </div>
      </div>
    </div>
  )
}
