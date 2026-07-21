import React from 'react'
import { categoryLabel, FLAG_CATEGORIES } from '../hooks/useListingFlags'

function relativeTime(epoch) {
  if (!epoch) return ''
  const ms   = epoch < 1e12 ? epoch * 1000 : epoch
  const diff = Math.max(0, Date.now() - ms)
  const m    = Math.floor(diff / 60000)
  if (m < 2)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h    = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d    = Math.floor(h / 24)
  if (d < 14)  return `${d}d ago`
  const w    = Math.floor(d / 7)
  return `${w}w ago`
}

/**
 * Detail-page section that shows the full breakdown of renter reports.
 *
 * Reports are anonymous: no names, no avatars, no device IDs are shown.
 * The current device's own flag (matched via `ownFlag`) bubbles to the top
 * with a "Retract report" button so users can self-correct.
 */
export default function RenterReports({
  flagsApi,        // useListingFlags(...) return value
  onRetract,
  onOpenModal,     // opens the flag modal so user can edit/submit
}) {
  if (!flagsApi) return null
  const { summary, flags, byCategory, ownFlag, loading, error } = flagsApi
  const total = summary?.count || 0

  if (loading && total === 0) {
    return (
      <section style={containerStyle}>
        <Header total={0} loading />
      </section>
    )
  }

  if (error && total === 0 && !ownFlag) {
    return null
  }

  // Don't show the section at all if there's nothing to show — keeps clean
  // listings clean.
  if (total === 0 && !ownFlag) {
    return null
  }

  // Order the breakdown by count desc, mirroring the FLAG_CATEGORIES order
  // for ties so the layout is stable.
  const orderIndex = Object.fromEntries(FLAG_CATEGORIES.map((c, i) => [c.key, i]))
  const breakdown = Object.entries(byCategory || {})
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (orderIndex[a.key] - orderIndex[b.key]))

  // Recent notes (max 6) from OTHER devices — own flag has its own pinned card.
  const otherNotes = (flags || [])
    .filter(f => f.id !== ownFlag?.id && f.note)
    .slice(0, 6)

  return (
    <section style={containerStyle}>
      <Header total={total} />

      {/* Pinned: this device's own flag (if any) */}
      {ownFlag && (
        <OwnFlagCard
          flag={ownFlag}
          onEdit={onOpenModal}
          onRetract={onRetract}
        />
      )}

      {/* Breakdown by category */}
      {breakdown.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <p style={miniLabel}>Breakdown</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {breakdown.map(item => (
              <li
                key={item.key}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 13, color: 'var(--color-text-muted)',
                  background: 'var(--color-bg-card)',
                  padding: '8px 12px',
                  borderRadius: 8,
                }}
              >
                <span>{categoryLabel(item.key)}</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                  color: 'var(--color-text-primary)',
                }}>
                  {item.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent anonymous notes */}
      {otherNotes.length > 0 && (
        <div>
          <p style={miniLabel}>Recent reports from renters</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {otherNotes.map(note => (
              <li
                key={note.id}
                style={{
                  background: 'var(--color-bg-card)',
                  borderLeft: '2px solid color-mix(in srgb, var(--color-accent) 45%, transparent)',
                  borderRadius: 6,
                  padding: '10px 12px',
                }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 4, gap: 8,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: '#E8A020',
                  }}>
                    {categoryLabel(note.category)}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--color-text-muted)',
                  }}>
                    reported {relativeTime(note.created_at)}
                  </span>
                </div>
                <p style={{
                  margin: 0, fontSize: 13, lineHeight: 1.5,
                  color: 'var(--color-text-primary)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {note.note}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {total === 0 && ownFlag && (
        <p style={{
          fontSize: 12, color: 'var(--color-text-muted)',
          marginTop: 4, marginBottom: 0,
        }}>
          You're the only person who's flagged this listing so far.
        </p>
      )}
    </section>
  )
}

function Header({ total, loading }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 14, gap: 12,
    }}>
      <div>
        <p style={sectionLabel}>Renter reports</p>
        <p style={{
          fontFamily: 'var(--font-sans)', fontSize: 12,
          color: 'var(--color-text-muted)', margin: 0,
          lineHeight: 1.4,
        }}>
          {loading
            ? 'Loading reports…'
            : total > 0
              ? `${total} ${total === 1 ? 'renter has' : 'renters have'} flagged this listing.`
              : 'No reports yet.'}
        </p>
      </div>
      <span
        title="Reports are informational only — they never hide or downrank a listing."
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)', borderRadius: 4,
          padding: '3px 7px', whiteSpace: 'nowrap', cursor: 'help',
          flexShrink: 0,
        }}
      >
        Soft signal
      </span>
    </div>
  )
}

function OwnFlagCard({ flag, onEdit, onRetract }) {
  return (
    <div style={{
      background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
      border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6, gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: '#E8A020', fontWeight: 500,
        }}>
          Your report
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--color-text-muted)',
        }}>
          {relativeTime(flag.created_at)}
        </span>
      </div>
      <p style={{
        fontSize: 13, color: 'var(--color-text-primary)',
        margin: 0, marginBottom: flag.note ? 6 : 10,
        lineHeight: 1.4,
      }}>
        {categoryLabel(flag.category)}
      </p>
      {flag.note && (
        <p style={{
          margin: 0, marginBottom: 10,
          fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-muted)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          “{flag.note}”
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onEdit}
          style={ghostBtn('var(--color-text-muted)')}
        >
          Edit
        </button>
        <button
          onClick={onRetract}
          style={ghostBtn('#F87171', 'rgba(248,113,113,0.35)')}
        >
          Retract report
        </button>
      </div>
    </div>
  )
}

const containerStyle = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-card)',
  padding: '16px 18px',
  marginBottom: 16,
}

const sectionLabel = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  marginBottom: 4,
}

const miniLabel = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  marginBottom: 8,
  marginTop: 0,
}

function ghostBtn(color, borderColor) {
  return {
    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
    textTransform: 'uppercase',
    background: 'transparent',
    border: `1px solid ${borderColor || 'var(--color-border)'}`,
    color,
    borderRadius: 8,
    padding: '7px 12px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, color 0.15s',
  }
}
