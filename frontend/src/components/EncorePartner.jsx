import React, { useState } from 'react';
import { motion } from 'framer-motion';

export const ENCORE_URL = import.meta.env.VITE_ENCORE_WAV_URL || 'https://www.encorewav.com/';

const ENCORE_TAGLINE = 'Music · Lifestyle · Merch';
const ENCORE_AD_DISMISSED_KEY = 'encore_ad_dismissed_session';

const fadeSlideUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.75, ease: [0.25, 0.46, 0.45, 0.94], delay },
  }),
};

const labelStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
};

const subtitleStyle = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 11,
  color: 'rgba(255, 255, 255, 0.28)',
  letterSpacing: '0.02em',
};

const logoImgStyle = {
  width: 'auto',
  display: 'block',
  objectFit: 'contain',
};

function ExternalLinkIcon() {
  return (
    <svg
      className="encore-external-link-icon"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function EncoreAnimatedTagline({ className }) {
  return (
    <span className={className} aria-label={ENCORE_TAGLINE}>
      <span className="encore-tagline-animated" aria-hidden="true">
        {[...ENCORE_TAGLINE].map((char, i) => (
          <span
            key={`${i}-${char}`}
            className="encore-tagline-char"
            style={{ '--char-index': i }}
          >
            {char === ' ' ? '\u00a0' : char}
          </span>
        ))}
      </span>
    </span>
  );
}

export function EncoreSidebarBadge() {
  return (
    <a
      href={ENCORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="In association with Encore Wav — music lifestyle and merch"
      className="encore-sidebar-badge"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        margin: '0 12px 12px',
        padding: '16px 14px',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.06)',
        textDecoration: 'none',
      }}
    >
      <span style={{ ...labelStyle, fontSize: 9, letterSpacing: '0.1em', textAlign: 'center' }}>
        In association with
      </span>
      <img
        src="/logo_new_encore.png"
        alt="Encore Wav"
        className="encore-logo-sidebar"
        style={{ ...logoImgStyle, height: 56, maxWidth: '100%' }}
      />
      <span style={{ ...subtitleStyle, textAlign: 'center' }}>
        Music · Lifestyle · Merch
      </span>
    </a>
  );
}

export function EncoreLeaderboardStrip() {
  const [visible, setVisible] = useState(
    () => typeof window === 'undefined' || !sessionStorage.getItem(ENCORE_AD_DISMISSED_KEY),
  );

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(ENCORE_AD_DISMISSED_KEY, '1');
  };

  if (!visible) return null;

  return (
    <motion.div
      className="encore-ad-zone"
      variants={fadeSlideUp}
      initial="hidden"
      animate="visible"
      custom={0.15}
    >
      <div className="encore-ad-header">
        <p className="encore-ad-microbar">Advertisement</p>
        <button
          type="button"
          className="encore-ad-dismiss"
          onClick={dismiss}
          aria-label="Dismiss advertisement"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <a
        href={ENCORE_URL}
        target="_blank"
        rel="noopener noreferrer sponsored"
        aria-label="Sponsored advertisement — Encore Wav. Music, lifestyle and merch. Opens external site."
        className="encore-leaderboard-strip"
      >
        <div className="encore-leaderboard-inner">
          <div className="encore-leaderboard-left">
            <span className="encore-leaderboard-sponsored">Sponsored</span>
            <span className="encore-leaderboard-partner">Encore Wav</span>
          </div>

          <div className="encore-leaderboard-divider" aria-hidden="true" />

          <div className="encore-leaderboard-center">
            <img
              src="/logo_encore_trimmed.png"
              alt=""
              className="encore-logo-leaderboard"
            />
          </div>

          <div className="encore-leaderboard-divider" aria-hidden="true" />

          <div className="encore-leaderboard-right">
            <EncoreAnimatedTagline className="encore-leaderboard-tagline" />
            <span className="encore-leaderboard-url-row">
              <span className="encore-leaderboard-url">encorewav.com</span>
              <ExternalLinkIcon />
            </span>
          </div>
        </div>
      </a>
    </motion.div>
  );
}
