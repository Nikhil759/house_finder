import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "../ThemeContext";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { AuthButton } from "./AuthButton";
import { useAuth } from "../hooks/useAuth";
import { useSavedSearches } from "../hooks/useSavedSearches";
import { useNewListings } from "../hooks/useNewListings";

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4"/>
    <line x1="12" y1="2"  x2="12" y2="5"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="2"  y1="12" x2="5"  y2="12"/>
    <line x1="19" y1="12" x2="22" y2="12"/>
    <line x1="4.22"  y1="4.22"  x2="6.34"  y2="6.34"/>
    <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
    <line x1="19.78" y1="4.22"  x2="17.66" y2="6.34"/>
    <line x1="6.34"  y1="17.66" x2="4.22"  y2="19.78"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const RadarLogo = () => (
  <svg width="24" height="24" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="none" stroke="#f5a623" strokeWidth="2"/>
    <circle cx="16" cy="16" r="8"  fill="none" stroke="#f5a623" strokeWidth="1.5" opacity="0.6"/>
    <circle cx="16" cy="16" r="3"  fill="#f5a623"/>
    <line x1="16" y1="16" x2="28" y2="6" stroke="#f5a623" strokeWidth="1.5" opacity="0.8"/>
  </svg>
);

/**
 * Shared navbar used across /, /app, and /health.
 *
 * Props:
 *   subtitle   — small text shown next to the logo (optional)
 *   showAppCta — show an "Open App →" button linking to /app (for landing page)
 *   transparent — no background / border (for overlay on hero images)
 */
function NotificationBell({ count, onClick }) {
  return (
    <button
      onClick={onClick}
      title="New listings for you"
      className="shared-nav-theme-btn"
      style={{ position: 'relative' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#f5a623'; e.currentTarget.style.color = '#f5a623'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = ''; }}
    >
      <i className={count > 0 ? 'fa-solid fa-bell' : 'fa-regular fa-bell'} style={{ fontSize: '14px' }} />
      {count > 0 && (
        <span style={{
          position: 'absolute',
          top: '-5px',
          right: '-5px',
          background: '#f5a623',
          color: '#000',
          borderRadius: '10px',
          fontSize: '9px',
          fontWeight: '700',
          padding: '1px 5px',
          minWidth: '15px',
          textAlign: 'center',
          lineHeight: '15px',
          pointerEvents: 'none',
        }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

export default function Navbar({ subtitle, showAppCta = false, transparent = false }) {
  const { theme, toggleTheme } = useTheme();
  const { canInstall, isIOS, triggerInstall } = usePWAInstall();
  const [showIOSTip, setShowIOSTip] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { savedSearches } = useSavedSearches(user);
  const { totalCount } = useNewListings(user, savedSearches);

  return (
    <>
      <style>{`
        .shared-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 32px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-primary);
          position: sticky;
          top: 0;
          z-index: 100;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .shared-nav.transparent {
          background: transparent;
          border-bottom: none;
        }
        .shared-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 20px;
          font-weight: 700;
          color: #f5a623;
          text-decoration: none;
          letter-spacing: 0.3px;
        }
        .shared-nav-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .shared-nav-sub {
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.3px;
        }
        .shared-nav-cta {
          display: inline-flex;
          font-size: 12px;
          font-weight: 600;
          color: #f5a623;
          text-decoration: none;
          border: 1px solid rgba(245,166,35,0.35);
          border-radius: 6px;
          padding: 6px 14px;
          transition: background 0.15s, border-color 0.15s;
          letter-spacing: 0.2px;
        }
        .shared-nav-cta:hover {
          background: rgba(245,166,35,0.1);
          border-color: rgba(245,166,35,0.6);
        }
        .shared-nav-health {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          color: var(--text-muted);
          text-decoration: none;
          font-size: 14px;
          transition: border-color 0.2s, color 0.2s;
          flex-shrink: 0;
        }
        .shared-nav-health:hover {
          border-color: #f5a623;
          color: #f5a623;
        }
        .shared-nav-theme-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 50%;
          color: var(--text-muted);
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s, background 0.2s;
          flex-shrink: 0;
        }
        .shared-nav-theme-btn:hover {
          border-color: #f5a623;
          color: #f5a623;
        }
        .shared-nav.transparent .shared-nav-health,
        .shared-nav.transparent .shared-nav-theme-btn {
          background: rgba(0,0,0,0.28);
          border-color: rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.7);
        }
        [data-theme="light"] .shared-nav.transparent .shared-nav-health,
        [data-theme="light"] .shared-nav.transparent .shared-nav-theme-btn {
          background: rgba(255,255,255,0.5);
          border-color: rgba(0,0,0,0.12);
          color: rgba(0,0,0,0.55);
        }
        .shared-nav.transparent .shared-nav-health:hover,
        .shared-nav.transparent .shared-nav-theme-btn:hover {
          background: rgba(0,0,0,0.45);
          border-color: rgba(255,255,255,0.3);
          color: #ffffff;
        }
        [data-theme="light"] .shared-nav.transparent .shared-nav-health:hover,
        [data-theme="light"] .shared-nav.transparent .shared-nav-theme-btn:hover {
          background: rgba(255,255,255,0.85);
          border-color: rgba(0,0,0,0.2);
          color: rgba(0,0,0,0.85);
        }
        .shared-nav.transparent .shared-nav-logo {
          color: #f5a623;
          text-shadow: 0 1px 4px rgba(0,0,0,0.5);
        }
        .shared-nav.transparent .shared-nav-cta {
          border-color: rgba(245,166,35,0.5);
          background: rgba(0,0,0,0.2);
        }
        .shared-nav-install {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          color: #f5a623;
          background: rgba(245,166,35,0.08);
          border: 1px solid rgba(245,166,35,0.25);
          border-radius: 6px;
          padding: 5px 10px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s, border-color 0.15s;
          flex-shrink: 0;
        }
        .shared-nav-install:hover {
          background: rgba(245,166,35,0.15);
          border-color: rgba(245,166,35,0.5);
        }
        .nav-ios-tip {
          position: fixed;
          top: 60px;
          right: 16px;
          z-index: 10000;
          background: #1a1a2a;
          border: 1px solid rgba(245,166,35,0.3);
          border-radius: 14px;
          padding: 16px 18px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          width: min(320px, calc(100vw - 32px));
        }
        .nav-ios-tip-title {
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 10px;
        }
        .nav-ios-tip-step {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          color: rgba(255,255,255,0.65);
          margin-bottom: 8px;
        }
        .nav-ios-tip-num {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(245,166,35,0.15);
          border: 1px solid rgba(245,166,35,0.3);
          color: #f5a623;
          font-size: 10px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .nav-ios-tip-close {
          margin-top: 12px;
          width: 100%;
          padding: 7px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: rgba(255,255,255,0.5);
          font-size: 12px;
          cursor: pointer;
        }
        @media (max-width: 600px) {
          .shared-nav { padding: 12px 16px; }
          .shared-nav-sub { display: none; }
          .shared-nav-health { display: none; }
          .shared-nav-install { display: none; }
          .shared-nav-cta { display: none; }
          .auth-user-name { display: none; }
          .auth-sign-out { display: none; }
        }
      `}</style>

      {showIOSTip && (
        <div className="nav-ios-tip">
          <div className="nav-ios-tip-title">Add to Home Screen</div>
          <div className="nav-ios-tip-step">
            <span className="nav-ios-tip-num">1</span>
            <span>Tap the <strong style={{color:"#fff"}}>Share</strong> button at the bottom of Safari</span>
          </div>
          <div className="nav-ios-tip-step">
            <span className="nav-ios-tip-num">2</span>
            <span>Scroll down and tap <strong style={{color:"#fff"}}>"Add to Home Screen"</strong></span>
          </div>
          <div className="nav-ios-tip-step">
            <span className="nav-ios-tip-num">3</span>
            <span>Tap <strong style={{color:"#fff"}}>Add</strong> — done!</span>
          </div>
          <button className="nav-ios-tip-close" onClick={() => setShowIOSTip(false)}>Got it</button>
        </div>
      )}

      <nav className={`shared-nav${transparent ? " transparent" : ""}`}>
        <Link to="/" className="shared-nav-logo">
          <RadarLogo />
          <span>NestIQ</span>
        </Link>

        <div className="shared-nav-right">
          {subtitle && <span className="shared-nav-sub">{subtitle}</span>}
          {showAppCta && (
            <Link to="/app" className="shared-nav-cta" style={{ alignItems: "center", gap: 6 }}>
              Search listings
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </Link>
          )}
          {canInstall && (
            <button
              className="shared-nav-install"
              onClick={async () => {
                const result = await triggerInstall();
                if (result === "ios") setShowIOSTip(v => !v);
              }}
              title="Add to home screen"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v13M8 11l4 4 4-4"/><rect x="3" y="17" width="18" height="4" rx="1"/>
              </svg>
              Install
            </button>
          )}
          {user && (
            <NotificationBell
              count={totalCount}
              onClick={() => navigate('/new')}
            />
          )}
          <Link to="/health" className="shared-nav-health" title="System health">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </Link>
          <button className="shared-nav-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <AuthButton />
        </div>
      </nav>
    </>
  );
}
