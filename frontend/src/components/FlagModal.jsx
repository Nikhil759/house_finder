import React, { useEffect, useRef, useState } from 'react'
import {
  FLAG_CATEGORIES,
  categoryLabel,
} from '../hooks/useListingFlags'

const NOTE_MAX = 500

/**
 * Anonymous-friendly listing report modal.
 *
 * Opens immediately on Flag-button click — never gated behind sign-in.
 * Single-select category + optional note (≤500 chars). Submit + cancel.
 *
 * Props:
 *   open         (bool)            — show / hide
 *   onClose      ()                — fired on backdrop, X, cancel
 *   onSubmit     ({category, note}) → Promise<{ok, code, existing}>
 *   onSubmitted  ()                — fired after a successful submit (for toast)
 *   submitting   (bool)
 *   existingFlag ({id,category,note}|null) — current device's already-active flag for this listing
 *   onRetract    ()                — fired when user taps "Retract" while editing
 */
export default function FlagModal({
  open,
  onClose,
  onSubmit,
  onSubmitted,
  submitting = false,
  existingFlag = null,
  onRetract,
}) {
  const isEditing = !!existingFlag

  const [category, setCategory] = useState(existingFlag?.category || '')
  const [note, setNote]         = useState(existingFlag?.note || '')
  const [error, setError]       = useState(null)
  const firstRowRef = useRef(null)

  // Reset state whenever the modal re-opens, seeded from any existing flag.
  useEffect(() => {
    if (!open) return
    setCategory(existingFlag?.category || '')
    setNote(existingFlag?.note || '')
    setError(null)
  }, [open, existingFlag])

  // ESC closes the modal.
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Auto-focus first option for keyboard users.
  useEffect(() => {
    if (open && firstRowRef.current) {
      firstRowRef.current.focus()
    }
  }, [open])

  if (!open) return null

  async function handleSubmit() {
    if (!category) {
      setError('Pick a reason so renters know what to look out for.')
      return
    }
    setError(null)
    const result = await onSubmit?.({ category, note: (note || '').trim() })
    if (result?.ok) {
      onSubmitted?.()
      onClose?.()
    } else if (result?.code === 'duplicate') {
      setError("You've already flagged this listing. View or retract it on the listing page.")
    } else if (result?.code === 'rate_limited' || result?.status === 429) {
      setError("You've flagged too many listings today. Try again tomorrow.")
    } else if (result) {
      setError("Couldn't submit your report — please try again in a moment.")
    }
  }

  const noteRemaining = Math.max(0, NOTE_MAX - (note?.length || 0))
  const charCounterColor = noteRemaining < 40
    ? 'var(--color-accent)'
    : 'var(--color-text-muted)'

  return (
    <>
      <style>{`
        @keyframes flagModalIn {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes flagBackdropIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>

      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.62)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          animation: 'flagBackdropIn 0.18s ease',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="flag-modal-title"
          style={{
            width: '100%',
            maxWidth: 460,
            margin: '0 auto',
            background: '#111111',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px 16px 0 0',
            padding: '20px 18px 18px',
            display: 'flex', flexDirection: 'column',
            maxHeight: '92vh',
            overflowY: 'auto',
            animation: 'flagModalIn 0.22s ease',
            boxShadow: '0 -16px 48px rgba(0,0,0,0.55)',
          }}
        >
          {/* Drag handle (mobile sheet feel) */}
          <div style={{
            width: 40, height: 4, background: '#333',
            borderRadius: 2, margin: '0 auto 14px',
          }} />

          {/* Title block */}
          <div style={{ marginBottom: 18, paddingRight: 28, position: 'relative' }}>
            <h2
              id="flag-modal-title"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400, fontSize: 18,
                letterSpacing: '-0.01em',
                color: 'var(--color-text-primary)',
                margin: 0, marginBottom: 6,
              }}
            >
              {isEditing ? 'Edit your report' : 'Flag this listing'}
            </h2>
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13, lineHeight: 1.45,
              color: 'rgba(255,255,255,0.55)',
              margin: 0,
            }}>
              Help renters avoid bad listings. Your report is anonymous.
            </p>

            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                position: 'absolute', top: -2, right: -4,
                width: 28, height: 28,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,255,255,0.75)',
                borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1,
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          {/* Categories */}
          <div role="radiogroup" aria-label="Reason" style={{
            display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16,
          }}>
            {FLAG_CATEGORIES.map((c, idx) => {
              const active = category === c.key
              return (
                <button
                  key={c.key}
                  ref={idx === 0 ? firstRowRef : null}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCategory(c.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px',
                    background: active ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : '#1A1A1A',
                    border: `1px solid ${active ? 'color-mix(in srgb, var(--color-accent) 45%, transparent)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 10,
                    color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.85)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 13.5, lineHeight: 1.3,
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      flexShrink: 0,
                      border: `1px solid ${active ? 'var(--color-accent)' : 'rgba(255,255,255,0.25)'}`,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {active && (
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: 'var(--color-accent)',
                      }} />
                    )}
                  </span>
                  <span>{c.label}</span>
                </button>
              )
            })}
          </div>

          {/* Optional note */}
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="flag-note"
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                marginBottom: 7,
              }}
            >
              Add context
              <span style={{ marginLeft: 6, opacity: 0.7 }}>(optional)</span>
            </label>
            <textarea
              id="flag-note"
              value={note}
              onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
              placeholder="What's wrong with this listing?"
              rows={3}
              style={{
                width: '100%', resize: 'vertical', minHeight: 64, maxHeight: 140,
                background: '#1A1A1A',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
                padding: '10px 12px',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-sans)', fontSize: 13.5,
                lineHeight: 1.5, outline: 'none',
                boxSizing: 'border-box',
              }}
              maxLength={NOTE_MAX}
            />
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: charCounterColor, marginTop: 5, textAlign: 'right',
            }}>
              {noteRemaining} characters left
            </div>
          </div>

          {error && (
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: 12.5, lineHeight: 1.4,
              color: '#F87171',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 8, padding: '8px 10px',
              marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isEditing && onRetract && (
              <button
                onClick={async () => {
                  await onRetract?.()
                  onClose?.()
                }}
                disabled={submitting}
                style={{
                  fontFamily: 'var(--font-sans)', fontSize: 13,
                  background: 'transparent',
                  color: '#F87171',
                  border: '1px solid rgba(248,113,113,0.4)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                Retract report
              </button>
            )}

            <div style={{ flex: 1 }} />

            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                fontFamily: 'var(--font-sans)', fontSize: 13,
                background: 'transparent',
                color: 'rgba(255,255,255,0.6)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                padding: '10px 14px',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !category}
              style={{
                fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
                background: 'var(--color-accent)',
                color: '#1a0a00',
                border: 'none',
                borderRadius: 10,
                padding: '10px 16px',
                cursor: submitting || !category ? 'not-allowed' : 'pointer',
                opacity: submitting || !category ? 0.55 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {submitting ? 'Submitting…' : isEditing ? 'Update report' : 'Submit report'}
            </button>
          </div>

          {category && !isEditing && (
            <p style={{
              fontFamily: 'var(--font-sans)', fontSize: 11.5,
              color: 'rgba(255,255,255,0.4)', marginTop: 12, marginBottom: 0,
              lineHeight: 1.45,
            }}>
              You'll report this as <span style={{ color: 'rgba(255,255,255,0.7)' }}>{categoryLabel(category).toLowerCase()}</span>.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
