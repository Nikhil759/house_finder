import React from 'react'

/**
 * Subtle bottom toast used for search auto-save notifications.
 *
 * toast shape:
 *   { type: 'info',  message: string }           — amber text, auto-dismisses
 *   { type: 'nudge', locality: string }           — sign-in prompt, manual dismiss
 */
export default function Toast({ toast, onDismiss, onSignIn }) {
  if (!toast) return null

  const isNudge = toast.type === 'nudge'

  return (
    <>
      <style>{`
        @keyframes toast-slide-up {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .nq-toast-close {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.10);
          color: rgba(255,255,255,0.78);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          font-size: 12px;
          line-height: 1;
          flex-shrink: 0;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .nq-toast-close:hover {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.18);
          color: #fff;
        }
        .nq-toast-close:active {
          background: rgba(255,255,255,0.18);
        }
      `}</style>

      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 88,
          left: 16,
          right: 16,
          maxWidth: 440,
          margin: '0 auto',
          zIndex: 1000,
          background: '#161616',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 14,
          padding: '12px 12px 12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px rgba(0,0,0,0.55)',
          animation: 'toast-slide-up 0.22s ease',
        }}
      >
        {isNudge ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'rgba(232,160,32,0.14)',
                  border: '1px solid rgba(232,160,32,0.28)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-amber)',
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                <i className="fa-solid fa-bolt" />
              </span>
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                lineHeight: 1.35,
                color: 'rgba(255,255,255,0.82)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                Sign in to get auto leads for{' '}
                <span style={{ color: 'var(--color-amber)', fontWeight: 500 }}>{toast.locality}</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => { onSignIn?.(); onDismiss?.() }}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: '0.01em',
                  background: 'var(--color-amber)',
                  color: '#1a0a00',
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 12px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Sign in
              </button>
              <button
                className="nq-toast-close"
                onClick={onDismiss}
                aria-label="Dismiss"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'rgba(232,160,32,0.14)',
                  border: '1px solid rgba(232,160,32,0.28)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-amber)',
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                <i className="fa-solid fa-check" />
              </span>
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                lineHeight: 1.35,
                color: 'rgba(255,255,255,0.85)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {toast.message}
              </span>
            </div>
            <button
              className="nq-toast-close"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </>
        )}
      </div>
    </>
  )
}
