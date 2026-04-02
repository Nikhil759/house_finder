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

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 88,
        left: 16,
        right: 16,
        zIndex: 1000,
        background: '#111',
        border: '0.5px solid #2A2A2A',
        borderRadius: 12,
        padding: '11px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        boxShadow: '0 4px 32px rgba(0,0,0,0.7)',
        animation: 'slideUp 0.2s ease',
      }}
    >
      {toast.type === 'nudge' ? (
        <>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            flex: 1,
            minWidth: 0,
          }}>
            Sign in to get auto leads for{' '}
            <span style={{ color: 'var(--color-amber)' }}>{toast.locality}</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => { onSignIn?.(); onDismiss?.() }}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.06em',
                background: 'var(--color-amber)',
                color: '#1a0a00',
                border: 'none',
                borderRadius: 6,
                padding: '5px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Sign in →
            </button>
            <button
              onClick={onDismiss}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                fontSize: 17,
                lineHeight: 1,
                padding: 0,
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </>
      ) : (
        <>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-amber)',
            flex: 1,
            minWidth: 0,
          }}>
            {toast.message}
          </span>
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 17,
              lineHeight: 1,
              padding: '0 0 0 8px',
              flexShrink: 0,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </>
      )}
    </div>
  )
}
