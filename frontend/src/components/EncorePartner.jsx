import React from 'react';
import { motion } from 'framer-motion';

export const ENCORE_URL = import.meta.env.VITE_ENCORE_WAV_URL || 'https://www.encorewav.com/';

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

export function EncoreHeaderBadge() {
  return (
    <a
      href={ENCORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="In association with Encore Wav — music lifestyle and merch"
      className="encore-header-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginLeft: 8,
        textDecoration: 'none',
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      <span className="encore-header-label" style={{ ...labelStyle, fontSize: 8, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
        In association with
      </span>
      <img
        src="/logo_encore_trimmed.png"
        alt="Encore Wav"
        className="encore-logo-header"
        style={{ ...logoImgStyle, height: 22, flexShrink: 0 }}
      />
    </a>
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

export function EncoreHeroBottomStrip() {
  return (
    <motion.a
      href={ENCORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="In association with Encore Wav — music lifestyle and merch"
      className="encore-hero-promo"
      variants={fadeSlideUp}
      initial="hidden"
      animate="visible"
      custom={1.65}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        marginTop: 32,
        textDecoration: 'none',
      }}
    >
      <span style={labelStyle}>In association with</span>
      <img
        src="/logo_new_encore.png"
        alt="Encore Wav"
        className="encore-logo-hero"
        style={{ ...logoImgStyle, height: 52 }}
      />
      <span style={subtitleStyle}>
        Music · Lifestyle · Merch
      </span>
    </motion.a>
  );
}
