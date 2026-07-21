import React, { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { trackSigninNudgeShown, trackSigninNudgeDismissed } from '../lib/posthog'

/**
 * Value-led sign-in modal. Triggered from multiple surfaces via `source` prop.
 * Sets localStorage attribution key before OAuth redirect so useAuth can fire
 * signin_completed with the correct source on return.
 */
export default function SignInModal({ source, onClose }) {
  const { signInWithGoogle } = useAuth()

  useEffect(() => {
    trackSigninNudgeShown({ source })
  }, [source])

  function handleSignIn() {
    localStorage.setItem('nestiq_signin_source', source)
    signInWithGoogle()
  }

  function handleDismiss() {
    trackSigninNudgeDismissed({ source })
    onClose()
  }

  return (
    <>
      <style>{`
        @keyframes signin-modal-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes signin-modal-scale {
          from { transform: translate(-50%, -50%) scale(0.95) translateY(8px); opacity: 0; }
          to   { transform: translate(-50%, -50%) scale(1) translateY(0);      opacity: 1; }
        }
      `}</style>

      <div
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9000,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'signin-modal-fade 0.2s ease',
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9001,
          width: 'calc(100% - 48px)',
          maxWidth: 360,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 16,
          padding: '32px 24px 24px',
          animation: 'signin-modal-scale 0.25s ease',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 400,
          fontSize: 20,
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
          marginBottom: 16,
        }}>
          Keep your shortlist forever
        </h2>

        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: '0 0 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <i className="fa-solid fa-shield-halved" style={{ color: 'var(--color-accent)', fontSize: 13, marginTop: 3, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              Keep your shortlist forever — across phone, laptop, and browser sessions
            </span>
          </li>
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <i className="fa-solid fa-bolt" style={{ color: 'var(--color-accent)', fontSize: 13, marginTop: 3, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              Auto-curated new listings in your interest areas, with seen/unseen tracking
            </span>
          </li>
        </ul>

        <button
          onClick={handleSignIn}
          style={{
            width: '100%',
            height: 48,
            background: 'var(--color-accent)',
            color: '#1a0a00',
            border: 'none',
            borderRadius: 12,
            fontFamily: 'var(--font-sans)',
            fontSize: 15,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            letterSpacing: '-0.01em',
            marginBottom: 12,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>

        <button
          onClick={handleDismiss}
          style={{
            width: '100%',
            height: 40,
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            transition: 'border-color 0.2s, color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-text-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          Maybe later
        </button>
      </div>
    </>
  )
}
