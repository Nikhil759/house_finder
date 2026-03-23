import { useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext'
import { useAuth } from '../hooks/useAuth'
import { useSavedSearches } from '../hooks/useSavedSearches'
import { useNewListings } from '../hooks/useNewListings'
import { useSavedListings } from '../hooks/useSavedListings'
import { AuthButton } from '../components/AuthButton'
import { BackgroundPattern } from '../components/BackgroundPattern'
import { MobileNav } from '../components/MobileNav'
import Navbar from '../components/Navbar'
import '../global.css'

const SOURCE_COLORS = {
  reddit:   '#ff4500',
  telegram: '#229ed9',
  nobroker: '#e63946',
  housing:  '#7c3aed',
}

const SOURCE_ICONS = {
  reddit:   'fa-brands fa-reddit',
  telegram: 'fa-brands fa-telegram',
  nobroker: 'fa-solid fa-building',
  housing:  'fa-solid fa-house',
}

const STATUS_STAGES = [
  { key: 'interested', label: 'Interested',     color: '#f5a623' },
  { key: 'contacted',  label: 'Contacted',      color: '#4ade80' },
  { key: 'visited',    label: 'Visited',        color: '#60a5fa' },
  { key: 'rejected',   label: 'Not interested', color: '#6b7280' },
]

function timeAgo(ts) {
  if (!ts) return ''
  const sec = Math.floor(Date.now() / 1000) - (typeof ts === 'string' ? Math.floor(new Date(ts).getTime() / 1000) : ts)
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function extractPhone(text) {
  if (!text) return null
  const match = text.match(/(?:\+91[-\s]?)?[6-9]\d{9}/)
  return match ? match[0].replace(/[-\s]/g, '') : null
}

function buildWhatsAppMessage(post) {
  const bhk      = post.bhk ? `${post.bhk} ` : ''
  const locality = post.locality ? ` in ${post.locality}` : ''
  return encodeURIComponent(`Hi! Saw your listing for a ${bhk}flat${locality}. Is it still available? Would love to schedule a visit.`)
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

// ── New Leads: mini card ────────────────────────────────────────────────────
function MiniCard({ post, onSave, onHide, savedStatus }) {
  const source    = post.source || 'reddit'
  const color     = SOURCE_COLORS[source] || '#888'
  const created   = post.created || post.created_utc || 0
  const url       = post.url || (post.permalink ? `https://reddit.com${post.permalink}` : null)
  const isHousing = source === 'housing'
  const isNoBroker = source === 'nobroker'
  const isStructured = isHousing || isNoBroker || source === 'telegram'

  const displayPrice    = isStructured ? (post.price_formatted || (post.price ? `₹${post.price.toLocaleString()}` : null)) : null
  const displayBhk      = post.bhk
  const displayLocality = post.locality
  const displayArea     = (isHousing || isNoBroker) && post.area_sqft ? `${post.area_sqft} sqft` : null
  const displayFurnishing = (isHousing || isNoBroker) ? post.furnishing : null
  const displayDeposit  = isHousing && post.deposit ? `₹${post.deposit.toLocaleString()} dep` : null

  const handleSave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onSave && onSave(post)
  }

  const handleHide = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onHide && onHide(post.id)
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      transition: 'border-color 0.2s, transform 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none' }}
    >
      {/* Clickable area */}
      <a
        href={url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', padding: '14px 16px 10px', textDecoration: 'none' }}
      >
        {/* Source row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isHousing ? 'Housing.com' : isNoBroker ? 'NoBroker' : source}
          </span>
          {post.quality_score != null && (
            <span style={{
              marginLeft: 'auto', fontSize: '11px', fontWeight: '700',
              color: post.quality_score >= 60 ? '#4ade80' : post.quality_score >= 40 ? '#f5a623' : 'var(--text-muted)',
              background: post.quality_score >= 60 ? 'rgba(74,222,128,0.1)' : post.quality_score >= 40 ? 'rgba(245,166,35,0.1)' : 'var(--bg-secondary)',
              border: `1px solid ${post.quality_score >= 60 ? 'rgba(74,222,128,0.25)' : post.quality_score >= 40 ? 'rgba(245,166,35,0.25)' : 'var(--border)'}`,
              borderRadius: '4px', padding: '1px 6px',
            }}>
              {post.quality_score}
            </span>
          )}
        </div>

        {/* Title */}
        <div style={{
          fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)',
          lineHeight: '1.4', marginBottom: isHousing && post.address ? '5px' : '9px',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {post.title}
        </div>

        {/* Housing.com address line */}
        {isHousing && post.address && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '10px', color: '#8b7cf8', marginBottom: '8px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            <i className="fa-solid fa-location-dot" style={{ fontSize: '9px', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.address.length > 60 ? post.address.slice(0, 60) + '…' : post.address}
            </span>
          </div>
        )}

        {/* Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {displayBhk && displayArea
            ? <span style={pillStyle}>{displayBhk} · {displayArea}</span>
            : displayBhk && <span style={pillStyle}>{displayBhk}</span>}
          {displayLocality && <span style={pillStyle}>{displayLocality}</span>}
          {displayPrice && (
            <span style={{ ...pillStyle, color: '#f5a623', borderColor: 'rgba(245,166,35,0.3)', background: 'rgba(245,166,35,0.08)' }}>
              {displayPrice}
            </span>
          )}
          {!displayPrice && (post.price || post.price_formatted) && (
            <span style={{ ...pillStyle, color: '#f5a623', borderColor: 'rgba(245,166,35,0.3)', background: 'rgba(245,166,35,0.08)' }}>
              {post.price_formatted || `₹${post.price.toLocaleString()}`}
            </span>
          )}
          {displayFurnishing && <span style={{ ...pillStyle, color: '#c084fc', borderColor: 'rgba(192,132,252,0.3)', background: 'rgba(192,132,252,0.08)' }}>{displayFurnishing}</span>}
          {displayDeposit && <span style={{ ...pillStyle, color: 'var(--text-muted)' }}>{displayDeposit}</span>}
          {created > 0 && <span style={{ ...pillStyle, marginLeft: 'auto' }}>{timeAgo(created)}</span>}
        </div>
      </a>

      {/* Action row */}
      {(onSave || onHide) && (
        <div style={{
          display: 'flex', gap: '6px', padding: '8px 16px 12px',
          borderTop: '1px solid var(--border)',
        }}>
          {onSave && (
            <button
              onClick={handleSave}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                background: savedStatus ? 'rgba(245,166,35,0.12)' : 'transparent',
                border: `1px solid ${savedStatus ? 'rgba(245,166,35,0.4)' : 'var(--border)'}`,
                color: savedStatus ? '#f5a623' : 'var(--text-muted)',
                fontWeight: savedStatus ? '600' : '400',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!savedStatus) { e.currentTarget.style.color = '#f5a623'; e.currentTarget.style.borderColor = 'rgba(245,166,35,0.45)'; e.currentTarget.style.background = 'rgba(245,166,35,0.08)'; } }}
              onMouseLeave={e => { if (!savedStatus) { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'transparent'; } }}
            >
              <i className={savedStatus ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'} style={{ fontSize: '10px' }} />
              {savedStatus ? 'Saved' : 'Save'}
            </button>
          )}
          {onHide && (
            <button
              onClick={handleHide}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b'; e.currentTarget.style.borderColor = 'rgba(255,107,107,0.3)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <i className="fa-regular fa-eye-slash" style={{ fontSize: '10px' }} /> Hide
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tracking: saved listing card ────────────────────────────────────────────
function TrackingCard({ post, onStatusChange, onNotesChange, onUnsave }) {
  const [notes, setNotes] = useState(post._notes || '')
  const [copyMsg, setCopyMsg] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const debounceRef = useRef(null)
  const dismissRef = useRef(null)
  const source      = post.source || 'reddit'
  const color       = SOURCE_COLORS[source] || '#888'
  const icon        = SOURCE_ICONS[source]  || 'fa-solid fa-link'
  const url         = post.url || (post.permalink ? `https://reddit.com${post.permalink}` : null)
  const phone       = extractPhone(post.title) || extractPhone(post.body)
  const currentStatus = post._status || 'interested'
  const isHousing   = source === 'housing'
  const isNoBroker  = source === 'nobroker'
  const isStructured = isHousing || isNoBroker || source === 'telegram'
  const displayPrice = isStructured
    ? (post.price_formatted || (post.price ? `₹${post.price.toLocaleString()}` : null))
    : null
  const displayArea  = (isHousing || isNoBroker) && post.area_sqft ? `${post.area_sqft} sqft` : null
  const displayFurnishing = (isHousing || isNoBroker) ? post.furnishing : null
  const displayDeposit    = isHousing && post.deposit ? `₹${post.deposit.toLocaleString()} dep` : null
  const sourceLabel = isHousing ? 'Housing.com' : isNoBroker ? 'NoBroker' : source

  const handleNotesChange = (val) => {
    setNotes(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onNotesChange(post.id, val), 800)
  }

  const handleStatusChange = (id, newStatus) => {
    onStatusChange(id, newStatus)
    if (newStatus === 'rejected') {
      setDismissing(true)
      setCountdown(2)
      let t = 2
      dismissRef.current = setInterval(() => {
        t -= 1
        setCountdown(t)
        if (t <= 0) {
          clearInterval(dismissRef.current)
          onUnsave(post)
        }
      }, 1000)
    }
  }

  const handleUndoDismiss = () => {
    clearInterval(dismissRef.current)
    setDismissing(false)
    setCountdown(null)
    onStatusChange(post.id, 'interested')
  }

  const handleCopyMessage = () => {
    const msg = decodeURIComponent(buildWhatsAppMessage(post))
    navigator.clipboard.writeText(msg).then(() => {
      setCopyMsg(true)
      setTimeout(() => setCopyMsg(false), 2000)
    })
  }

  if (dismissing) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '16px',
        opacity: 0.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        transition: 'opacity 0.3s',
      }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Removing in {countdown}s…
        </span>
        <button
          onClick={handleUndoDismiss}
          style={{
            padding: '4px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          Undo
        </button>
      </div>
    )
  }


  const statusPipeline = (
    <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
      {STATUS_STAGES.map(stage => {
        const active = currentStatus === stage.key
        return (
          <button
            key={stage.key}
            onClick={() => handleStatusChange(post.id, stage.key)}
            style={{
              flex: 1,
              padding: '5px 4px', borderRadius: '20px',
              border: `1px solid ${active ? stage.color : 'var(--border)'}`,
              background: active ? `${stage.color}22` : 'transparent',
              color: active ? stage.color : 'var(--text-muted)',
              fontSize: '11px', fontWeight: active ? '600' : '400',
              cursor: 'pointer', transition: 'all 0.15s',
              textAlign: 'center', whiteSpace: 'nowrap',
            }}
          >
            {active && '✓ '}{stage.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '14px 16px',
        transition: 'border-color 0.2s, transform 0.15s, box-shadow 0.2s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(245,166,35,0.35)'
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Row 1: source · title · pills · time · remove */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: '10px', color, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sourceLabel}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginLeft: '4px' }}>
              {post.bhk && displayArea
                ? <span style={{ ...pillStyle, padding: '1px 6px' }}>{post.bhk} · {displayArea}</span>
                : post.bhk && <span style={{ ...pillStyle, padding: '1px 6px' }}>{post.bhk}</span>}
              {post.locality && <span style={{ ...pillStyle, padding: '1px 6px' }}>{post.locality}</span>}
              {(displayPrice || post.price || post.price_formatted) && (
                <span style={{ ...pillStyle, padding: '1px 6px', color: '#f5a623', borderColor: 'rgba(245,166,35,0.3)', background: 'rgba(245,166,35,0.08)' }}>
                  {displayPrice || post.price_formatted || `₹${(post.price || 0).toLocaleString()}`}
                </span>
              )}
              {displayFurnishing && (
                <span style={{ ...pillStyle, padding: '1px 6px', color: '#c084fc', borderColor: 'rgba(192,132,252,0.3)', background: 'rgba(192,132,252,0.08)' }}>
                  {displayFurnishing}
                </span>
              )}
              {displayDeposit && (
                <span style={{ ...pillStyle, padding: '1px 6px', color: 'var(--text-muted)' }}>{displayDeposit}</span>
              )}
            </div>
            {post._saved_at && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {timeAgo(post._saved_at)}
              </span>
            )}
          </div>
          {/* Housing.com address line */}
          {isHousing && post.address && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '10px', color: '#8b7cf8', marginBottom: '4px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <i className="fa-solid fa-location-dot" style={{ fontSize: '9px', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {post.address.length > 70 ? post.address.slice(0, 70) + '…' : post.address}
              </span>
            </div>
          )}
          <div style={{
            fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)',
            lineHeight: '1.45',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {post.title}
          </div>
        </div>
        {/* Remove — top right */}
        <button
          onClick={() => onUnsave(post)}
          title="Remove"
          style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '28px', borderRadius: '6px',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b'; e.currentTarget.style.borderColor = 'rgba(255,107,107,0.4)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      {/* Row 2: status pipeline left · action buttons right */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px', flexWrap: 'wrap',
        paddingTop: '10px', paddingBottom: '10px',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        marginBottom: '10px',
      }}>
        {statusPipeline}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '4px 9px', borderRadius: '6px',
              background: `${color}18`, border: `1px solid ${color}44`,
              color, fontSize: '11px', fontWeight: '600', textDecoration: 'none',
            }}>
              <i className={icon} style={{ fontSize: '10px' }} /> Open
            </a>
          )}
          {phone && (
            <a href={`https://wa.me/91${phone}?text=${buildWhatsAppMessage(post)}`} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '4px 9px', borderRadius: '6px',
              background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)',
              color: '#25d366', fontSize: '11px', fontWeight: '600', textDecoration: 'none',
            }}>
              <i className="fa-brands fa-whatsapp" style={{ fontSize: '10px' }} /> WhatsApp
            </a>
          )}
          <button onClick={handleCopyMessage} style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '4px 9px', borderRadius: '6px',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            color: copyMsg ? '#4ade80' : 'var(--text-secondary)',
            fontSize: '11px', cursor: 'pointer',
          }}>
            <i className={copyMsg ? 'fa-solid fa-check' : 'fa-regular fa-copy'} style={{ fontSize: '10px' }} />
            {copyMsg ? 'Copied!' : 'Copy outreach'}
          </button>
        </div>
      </div>

      {/* Row 3: notes full width */}
      <textarea
        value={notes}
        onChange={e => handleNotesChange(e.target.value)}
        placeholder="Notes (auto-saved)…"
        rows={2}
        style={{
          width: '100%', background: 'var(--bg-secondary)',
          border: '1px solid var(--border)', borderRadius: '8px',
          padding: '7px 10px', color: 'var(--text-primary)',
          fontSize: '12px', resize: 'vertical', outline: 'none',
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function NewForYou() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { user } = useAuth()
  const { savedSearches } = useSavedSearches(user)
  const [sinceWindow, setSinceWindow] = useState('7d')
  const sinceOverride = useMemo(() => {
    const ms = sinceWindow === '24h' ? 24 * 60 * 60 * 1000
             : sinceWindow === '3d'  ? 3 * 24 * 60 * 60 * 1000
                                     : 7 * 24 * 60 * 60 * 1000
    return new Date(Date.now() - ms).toISOString()
  }, [sinceWindow])
  const { newListings, totalCount, badgeCount, loading, markAllSeen } = useNewListings(user, savedSearches, sinceOverride)
  const { savedListings, isSaved, saveListing, updateStatus, updateNotes } = useSavedListings(user)
  const [hiddenLeads, setHiddenLeads] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nestiq_hub_hidden') || '[]')) } catch { return new Set() }
  })

  const [activeTab, setActiveTab] = useState('saved')

  const handleHideLead = (id) => {
    setHiddenLeads(prev => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem('nestiq_hub_hidden', JSON.stringify([...next]))
      return next
    })
  }

  // Switch to My Listings tab automatically when user saves something and comes here
  const savedCount = savedListings.length

  if (!user) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg-primary)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '16px', padding: '24px',
        position: 'relative',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute', top: '20px', left: '20px',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '7px 12px',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <i className="fa-solid fa-arrow-left" style={{ fontSize: '11px' }} />
          Back
        </button>

        <i className="fa-solid fa-layer-group" style={{ fontSize: '40px', color: '#f5a623' }} />
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '22px' }}>My Hub</h2>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0, fontSize: '14px', maxWidth: '260px' }}>
          Sign in to track listings and see new matches for your searches
        </p>
        <AuthButton />
        <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0, textAlign: 'center' }}>
          Free · No spam · Sync across devices
        </p>
      </div>
    )
  }

  return (
    <div className="app-page">
      <BackgroundPattern theme={theme} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar newCount={badgeCount} />

        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>

          {/* Page header */}
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{
              color: 'var(--text-primary)', fontSize: '20px', fontWeight: '700',
              margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '10px',
            }}>
              <i className="fa-solid fa-layer-group" style={{ color: '#f5a623', fontSize: '18px' }} />
              My Hub
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
              Your new leads and saved listings in one place
            </p>
          </div>

          {/* Tabs */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            marginBottom: '28px',
          }}>
            {[
              { key: 'saved', label: 'My Listings', icon: 'fa-solid fa-bookmark',    badge: savedCount > 0 ? savedCount : null },
              { key: 'leads', label: 'New Leads',   icon: 'fa-solid fa-bolt',        badge: badgeCount > 0 ? badgeCount : null },
            ].map(tab => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    background: active ? 'rgba(245,166,35,0.1)' : 'var(--bg-card)',
                    border: `1.5px solid ${active ? '#f5a623' : 'var(--border)'}`,
                    borderRadius: '12px',
                    color: active ? '#f5a623' : 'var(--text-muted)',
                    fontSize: '13px',
                    fontWeight: active ? '700' : '400',
                    padding: '9px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.18s',
                    boxShadow: active ? '0 0 0 1px rgba(245,166,35,0.15)' : 'none',
                  }}
                >
                  <i className={tab.icon} style={{ fontSize: '13px' }} />
                  {tab.label}
                  {tab.badge != null && (
                    <span style={{
                      background: active ? '#f5a623' : 'var(--bg-secondary)',
                      color: active ? '#000' : 'var(--text-muted)',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '700',
                      padding: '2px 7px',
                      minWidth: '20px',
                      textAlign: 'center',
                      lineHeight: '16px',
                    }}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ── Tab: New Leads ─────────────────────────────────────────────── */}
          {activeTab === 'leads' && (
            <>
              {/* Time window picker */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>Show:</span>
                {[
                  { key: '24h', label: 'Last 24h' },
                  { key: '3d',  label: 'Last 3 days' },
                  { key: '7d',  label: 'Last 7 days' },
                ].map(w => {
                  const active = sinceWindow === w.key
                  return (
                    <button
                      key={w.key}
                      onClick={() => setSinceWindow(w.key)}
                      style={{
                        padding: '4px 12px', borderRadius: '20px', fontSize: '12px',
                        cursor: 'pointer', transition: 'all 0.15s',
                        background: active ? 'rgba(245,166,35,0.12)' : 'transparent',
                        border: `1px solid ${active ? '#f5a623' : 'var(--border)'}`,
                        color: active ? '#f5a623' : 'var(--text-muted)',
                        fontWeight: active ? '600' : '400',
                      }}
                    >
                      {w.label}
                    </button>
                  )
                })}
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '24px', flexWrap: 'wrap', gap: '10px',
              }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                  {totalCount > 0
                    ? `${totalCount} ${totalCount === 1 ? 'listing' : 'listings'} in the last ${sinceWindow === '24h' ? '24 hours' : sinceWindow === '3d' ? '3 days' : '7 days'}`
                    : loading
                      ? 'Checking your saved searches…'
                      : `No listings in the last ${sinceWindow === '24h' ? '24 hours' : sinceWindow === '3d' ? '3 days' : '7 days'}`}
                  {loading && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      refreshing…
                    </span>
                  )}
                  {!loading && badgeCount > totalCount && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      · {badgeCount} new since your last visit
                    </span>
                  )}
                </p>
                {badgeCount > 0 && (
                  <button
                    onClick={markAllSeen}
                    style={{
                      background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: '8px', padding: '6px 14px',
                      color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
                    }}
                  >
                    Mark all seen
                  </button>
                )}
              </div>

              {/* Skeleton on first load */}
              {loading && Object.keys(newListings).length === 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px', marginBottom: '48px' }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: '10px', height: '130px', opacity: 0.4,
                      animation: 'pulse 1.5s ease-in-out infinite',
                      animationDelay: `${i * 0.1}s`,
                    }} />
                  ))}
                </div>
              )}

              {/* No saved searches */}
              {!loading && savedSearches.length === 0 && Object.keys(newListings).length === 0 && (
                <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
                  <i className="fa-regular fa-magnifying-glass" style={{ fontSize: '40px', marginBottom: '16px', display: 'block' }} />
                  <p style={{ fontSize: '14px', marginBottom: '20px' }}>Save a search first to see new listings here</p>
                  <button
                    onClick={() => navigate('/app')}
                    style={{
                      background: '#f5a623', border: 'none', borderRadius: '8px',
                      padding: '10px 24px', color: '#000', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
                    }}
                  >
                    Start searching →
                  </button>
                </div>
              )}

              {/* All caught up */}
              {!loading && savedSearches.length > 0 && totalCount === 0 && (
                <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
                  <i className="fa-regular fa-circle-check" style={{ fontSize: '40px', color: '#4ade80', marginBottom: '16px', display: 'block' }} />
                  <p style={{ fontSize: '14px' }}>You're all caught up — no new listings since your last check</p>
                  <button
                    onClick={() => navigate('/app')}
                    style={{
                      marginTop: '12px', background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: '8px',
                      padding: '8px 20px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer',
                    }}
                  >
                    Search again →
                  </button>
                </div>
              )}

              {/* Listings grouped by saved search */}
              {Object.values(newListings).map(({ search, listings }) => (
                <div key={search.id} style={{ marginBottom: '48px' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border)',
                  }}>
                    <div>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600', fontSize: '15px' }}>
                        {search.name}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '10px' }}>
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
                        background: 'transparent', border: '1px solid var(--border)',
                        borderRadius: '6px', padding: '5px 12px',
                        color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
                      }}
                    >
                      View all →
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
                    {listings.filter(l => !hiddenLeads.has(l.id)).map(listing => (
                      <MiniCard
                        key={listing.id}
                        post={listing}
                        onSave={saveListing}
                        onHide={handleHideLead}
                        savedStatus={isSaved(listing.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Tab: My Listings ───────────────────────────────────────────── */}
          {activeTab === 'saved' && (
            <>
              {savedListings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
                  <i className="fa-regular fa-bookmark" style={{ fontSize: '40px', marginBottom: '16px', display: 'block' }} />
                  <p style={{ fontSize: '14px', marginBottom: '6px' }}>No saved listings yet</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                    Hover a card and tap <strong style={{ color: 'var(--text-secondary)' }}>Save</strong> to track it here
                  </p>
                  <button
                    onClick={() => navigate('/app')}
                    style={{
                      background: '#f5a623', border: 'none', borderRadius: '8px',
                      padding: '10px 24px', color: '#000', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
                    }}
                  >
                    Browse listings →
                  </button>
                </div>
              ) : (
                <StatusFilterBar
                  listings={savedListings}
                  onStatusChange={updateStatus}
                  onNotesChange={updateNotes}
                  onUnsave={saveListing}
                />
              )}
            </>
          )}

        </div>
      </div>
      <MobileNav />
    </div>
  )
}

// ── Status filter bar + filtered list ──────────────────────────────────────
function StatusFilterBar({ listings: allListings, onStatusChange, onNotesChange, onUnsave }) {
  const [filter, setFilter] = useState('all')

  const counts = STATUS_STAGES.reduce((acc, s) => {
    acc[s.key] = allListings.filter(p => (p._status || 'interested') === s.key).length
    return acc
  }, {})

  const filtered = filter === 'all'
    ? allListings
    : allListings.filter(p => (p._status || 'interested') === filter)

  return (
    <>
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '4px 12px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
            border: `1px solid ${filter === 'all' ? '#f5a623' : 'var(--border)'}`,
            background: filter === 'all' ? 'rgba(245,166,35,0.1)' : 'transparent',
            color: filter === 'all' ? '#f5a623' : 'var(--text-muted)',
            fontWeight: filter === 'all' ? '600' : '400',
          }}
        >
          All ({allListings.length})
        </button>
        {STATUS_STAGES.map(stage => {
          const active = filter === stage.key
          const count = counts[stage.key]
          if (count === 0 && !active) return null
          return (
            <button
              key={stage.key}
              onClick={() => setFilter(stage.key)}
              style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
                border: `1px solid ${active ? stage.color : 'var(--border)'}`,
                background: active ? `${stage.color}18` : 'transparent',
                color: active ? stage.color : 'var(--text-muted)',
                fontWeight: active ? '600' : '400',
              }}
            >
              {stage.label} ({count})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
          No listings with this status
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(post => (
            <TrackingCard
              key={post.id}
              post={post}
              onStatusChange={onStatusChange}
              onNotesChange={onNotesChange}
              onUnsave={onUnsave}
            />
          ))}
        </div>
      )}
    </>
  )
}
