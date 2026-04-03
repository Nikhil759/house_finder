import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthButton } from './AuthButton';

/**
 * Shared app header used on every page.
 *
 * Props:
 *   backTo      — if true, shows "← Back" (navigate(-1)) on the left instead of the logo.
 *                 Pass `true` for detail pages (ListingDetail, PulseLocality).
 *   transparent — if true the header starts invisible and frosts in when the user scrolls
 *                 past 40px. Use on the Landing page hero.
 */
export default function AppHeader({ backTo = false, transparent = false }) {
  const navigate = useNavigate();
  // Non-transparent headers are always frosted; transparent ones start clear.
  const [scrolled, setScrolled] = useState(!transparent);

  useEffect(() => {
    if (!transparent) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [transparent]);

  return (
    <header className="nestiq-app-header" style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      height: 56,
      background: scrolled ? 'rgba(10,10,10,0.92)' : 'transparent',
      backdropFilter: scrolled ? 'blur(24px)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(24px)' : 'none',
      borderBottom: `1px solid ${scrolled ? 'var(--color-border)' : 'transparent'}`,
      transition: 'background 0.3s, border-color 0.3s',
      flexShrink: 0,
    }}>

      {/* ── Left: logo or back button ── */}
      {backTo ? (
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            padding: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            letterSpacing: '0.04em',
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          ← Back
        </button>
      ) : (
        <Link
          to="/"
          className="nestiq-header-logo"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
          }}
        >
          <img
            src="/icon.svg"
            alt="NestIQ logo"
            style={{ width: 26, height: 26 }}
          />
          <span style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 300,
            fontSize: 18,
            letterSpacing: '-0.02em',
            color: 'var(--color-text-primary)',
          }}>
            Nest<span style={{
              color: 'var(--color-amber)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
            }}>IQ</span>
          </span>
        </Link>
      )}

      {/* ── Right: auth button ── */}
      <AuthButton />
    </header>
  );
}
