import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthButton } from './AuthButton';
import { CitySwitcher } from './CitySwitcher';
import Logo from './Logo';
import { useCity } from '../CityContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useDesktop } from '../hooks/useDesktop';

const isAndroid =
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/**
 * Shared app header used on every page.
 *
 * Props:
 *   backTo      — if true, shows "← Back" (navigate(-1)) on the left instead of the logo.
 *   transparent — if true the header starts invisible and frosts in when the user scrolls
 *                 past 40px. Use on the Landing page hero.
 */
export default function AppHeader({ backTo = false, transparent = false }) {
  const navigate = useNavigate();
  const isDesktop = useDesktop();
  const { city } = useCity();
  const { isInstalled, isIOS, triggerInstall } = usePWAInstall();
  const [showIOSTip, setShowIOSTip] = useState(false);
  const [showManualTip, setShowManualTip] = useState(false);
  const [scrolled, setScrolled] = useState(!transparent);

  useEffect(() => {
    if (!transparent) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [transparent]);

  const showInstallBtn = !isDesktop && !isInstalled;

  const handleInstall = async () => {
    const result = await triggerInstall();
    if (result === 'ios') {
      setShowIOSTip(true);
    } else if (result === 'accepted') {
      setShowIOSTip(false);
      setShowManualTip(false);
    } else {
      setShowManualTip(true);
    }
  };

  const InstallIcon = () => (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2v13M8 11l4 4 4-4" />
      <rect x="3" y="17" width="18" height="4" rx="1" />
    </svg>
  );

  const installBtnStyle = {
    display: showInstallBtn ? 'inline-flex' : 'none',
    alignItems: 'center',
    gap: 5,
    padding: '3px 8px',
    marginLeft: 10,
    background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
    borderRadius: 6,
    color: 'var(--color-accent)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s, border-color 0.15s',
  };

  const installLabelStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 8,
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    lineHeight: 1,
  };

  return (
    <>
      <style>{`
        @media (max-width: 1023px) {
          .nestiq-install-manual-tip {
            position: fixed;
            top: 64px;
            left: 16px;
            right: 16px;
            z-index: 10001;
            background: var(--color-bg-surface);
            border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
            border-radius: 14px;
            padding: 16px 18px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          }
        }
      `}</style>

      <header
        className="nestiq-app-header"
        style={{
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
          gap: 12,
        }}
      >
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
            }}
          >
            ← Back
          </button>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            flex: 1,
          }}>
            <Link
              to={city === 'gurgaon' ? '/gurgaon' : '/'}
              className="nestiq-header-logo"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textDecoration: 'none',
                minWidth: 0,
              }}
            >
              <Logo size={26} />
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 300,
                fontSize: 18,
                letterSpacing: '-0.02em',
                color: city === 'gurgaon' ? 'var(--color-accent)' : 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
              }}>
                Nest<span style={{
                  color: 'var(--color-accent)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 500,
                }}>IQ</span>
              </span>
            </Link>

            <button
              type="button"
              onClick={handleInstall}
              aria-label="Install NestIQ app"
              title="Add to home screen"
              style={installBtnStyle}
            >
              <InstallIcon />
              <span style={installLabelStyle}>Install</span>
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <CitySwitcher />
          <AuthButton />
        </div>
      </header>

      {showIOSTip && (
        <div className="nestiq-install-manual-tip">
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>
            Add to Home Screen
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              'Tap the Share button at the bottom of Safari',
              'Scroll down and tap "Add to Home Screen"',
              'Tap Add — done!',
            ].map((step, i) => (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  color: 'var(--color-accent)',
                  fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowIOSTip(false)}
            style={{
              marginTop: 14, width: '100%', padding: 8,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              color: 'var(--color-text-muted)',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      )}

      {showManualTip && !showIOSTip && (
        <div className="nestiq-install-manual-tip">
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>
            Install NestIQ
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            {isAndroid
              ? 'Open the browser menu (⋮) and tap "Install app" or "Add to Home screen".'
              : 'Use your browser menu to install this app or add it to your home screen.'}
          </p>
          <button
            type="button"
            onClick={() => setShowManualTip(false)}
            style={{
              width: '100%', padding: 8,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              color: 'var(--color-text-muted)',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      )}
    </>
  );
}
