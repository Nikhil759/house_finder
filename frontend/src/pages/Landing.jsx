import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useInView, animate } from 'framer-motion';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import RadarAnimation from '../components/RadarAnimation';
import '../global.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

const SOURCE_DEFS = [
  { id: 'reddit',   label: 'Reddit',      icon: 'fa-brands fa-reddit',   color: '#ff4500' },
  { id: 'telegram', label: 'Telegram',    icon: 'fa-brands fa-telegram', color: '#229ed9' },
  { id: 'nobroker', label: 'NoBroker',    icon: 'fa-solid fa-building',  color: '#e63946' },
  { id: 'housing',  label: 'Housing.com', icon: 'fa-solid fa-house',     color: '#7c3aed' },
  { id: '99acres',  label: '99acres',     icon: 'fa-solid fa-landmark',  color: '#555', comingSoon: true },
];

const s = {
  page: {
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    minHeight: '100vh',
    paddingBottom: 80,
  },
  section: {
    padding: '80px 24px',
    maxWidth: 800,
    margin: '0 auto',
  },
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.14em',
    color: 'var(--color-amber)',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  h2: {
    fontWeight: 300,
    fontSize: 28,
    letterSpacing: '-0.025em',
    lineHeight: 1.2,
    marginBottom: 12,
  },
  subtext: {
    fontFamily: 'Inter, sans-serif',
    color: '#666666',
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 32,
  },
  card: {
    background: 'var(--color-bg-surface)',
    borderRadius: 'var(--radius-card)',
    padding: '18px 20px',
  },
  monoTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.06em',
    background: 'var(--color-bg-card)',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    padding: '4px 10px',
    display: 'inline-block',
  },
};

function SectionDivider() {
  return (
    <div style={{ width: '100%', height: 24, opacity: 0.28, overflow: 'hidden', flexShrink: 0 }}>
      <svg width="100%" height="24" viewBox="0 0 523 49" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="40.1365" y1="0.389806" x2="80.2042" y2="45.4661" stroke="#E8A020"/>
        <line x1="21.1412" y1="23.3952" x2="40.1412" y2="45.3952" stroke="#E8A020"/>
        <line x1="32.1214" y1="10.3736" x2="66.1214" y2="45.3736" stroke="#E8A020"/>
        <line x1="10.0991" y1="35.352" x2="21.0991" y2="45.352" stroke="#E8A020"/>
        <line x1="53.4092" y1="12.3684" x2="65.4092" y2="0.368435" stroke="#E8A020"/>
        <line x1="74.3923" y1="32.3862" x2="103.392" y2="0.386228" stroke="#E8A020"/>
        <line x1="121.136" y1="1.38981" x2="161.204" y2="46.4661" stroke="#E8A020"/>
        <line x1="134.409" y1="13.3684" x2="146.409" y2="1.36844" stroke="#E8A020"/>
        <line x1="155.392" y1="33.3862" x2="184.392" y2="1.38623" stroke="#E8A020"/>
        <line x1="113.121" y1="11.3736" x2="147.121" y2="46.3736" stroke="#E8A020"/>
        <line x1="102.141" y1="24.3952" x2="121.141" y2="46.3952" stroke="#E8A020"/>
        <line x1="91.0991" y1="36.352" x2="102.099" y2="46.352" stroke="#E8A020"/>
        <line x1="202.136" y1="2.38981" x2="242.204" y2="47.4661" stroke="#E8A020"/>
        <line x1="215.409" y1="14.3684" x2="227.409" y2="2.36844" stroke="#E8A020"/>
        <line x1="236.392" y1="34.3862" x2="265.392" y2="2.38623" stroke="#E8A020"/>
        <line x1="194.121" y1="12.3736" x2="228.121" y2="47.3736" stroke="#E8A020"/>
        <line x1="183.141" y1="25.3952" x2="202.141" y2="47.3952" stroke="#E8A020"/>
        <line x1="172.099" y1="37.352" x2="183.099" y2="47.352" stroke="#E8A020"/>
        <line x1="283.136" y1="1.38981" x2="323.204" y2="46.4661" stroke="#E8A020"/>
        <line x1="296.409" y1="13.3684" x2="308.409" y2="1.36844" stroke="#E8A020"/>
        <line x1="317.392" y1="33.3862" x2="346.392" y2="1.38623" stroke="#E8A020"/>
        <line x1="275.121" y1="11.3736" x2="309.121" y2="46.3736" stroke="#E8A020"/>
        <line x1="264.141" y1="24.3952" x2="283.141" y2="46.3952" stroke="#E8A020"/>
        <line x1="253.099" y1="36.352" x2="264.099" y2="46.352" stroke="#E8A020"/>
        <line x1="363.136" y1="1.38981" x2="403.204" y2="46.4661" stroke="#E8A020"/>
        <line x1="376.409" y1="13.3684" x2="388.409" y2="1.36844" stroke="#E8A020"/>
        <line x1="397.392" y1="33.3862" x2="426.392" y2="1.38623" stroke="#E8A020"/>
        <line x1="355.121" y1="11.3736" x2="389.121" y2="46.3736" stroke="#E8A020"/>
        <line x1="344.141" y1="24.3952" x2="363.141" y2="46.3952" stroke="#E8A020"/>
        <line x1="443.136" y1="1.38981" x2="483.204" y2="46.4661" stroke="#E8A020"/>
        <line x1="456.409" y1="13.3684" x2="468.409" y2="1.36844" stroke="#E8A020"/>
        <line x1="477.392" y1="33.3862" x2="506.392" y2="1.38623" stroke="#E8A020"/>
        <line x1="435.121" y1="11.3736" x2="469.121" y2="46.3736" stroke="#E8A020"/>
        <line x1="424.141" y1="24.3952" x2="443.141" y2="46.3952" stroke="#E8A020"/>
        <line x1="494.099" y1="37.352" x2="505.099" y2="47.352" stroke="#E8A020"/>
        <line x1="0.381378" y1="46.3986" x2="39.3814" y2="0.398644" stroke="#E8A020"/>
        <line x1="80.3814" y1="46.3986" x2="119.381" y2="0.398644" stroke="#E8A020"/>
        <line x1="62.4168" y1="23.361" x2="86.4168" y2="0.360994" stroke="#E8A020"/>
        <line x1="403.381" y1="47.3986" x2="442.381" y2="1.39864" stroke="#E8A020"/>
        <line x1="483.381" y1="47.3986" x2="522.381" y2="1.39864" stroke="#E8A020"/>
        <line x1="465.417" y1="24.361" x2="489.417" y2="1.36099" stroke="#E8A020"/>
        <line x1="323.381" y1="47.3986" x2="362.381" y2="1.39864" stroke="#E8A020"/>
        <line x1="385.417" y1="24.361" x2="409.417" y2="1.36099" stroke="#E8A020"/>
        <line x1="243.381" y1="47.3986" x2="282.381" y2="1.39864" stroke="#E8A020"/>
        <line x1="305.417" y1="24.361" x2="329.417" y2="1.36099" stroke="#E8A020"/>
        <line x1="162.381" y1="48.3986" x2="201.381" y2="2.39864" stroke="#E8A020"/>
        <line x1="242.381" y1="48.3986" x2="281.381" y2="2.39864" stroke="#E8A020"/>
        <line x1="224.417" y1="25.361" x2="248.417" y2="2.36099" stroke="#E8A020"/>
        <line x1="143.417" y1="24.361" x2="167.417" y2="1.36099" stroke="#E8A020"/>
      </svg>
    </div>
  );
}

/* ── Magnetic search bar wrapper ─────────────────────────────────────────── */
function MagneticSearchBar({ children }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setOffset({ x: (e.clientX - cx) * 0.06, y: (e.clientY - cy) * 0.12 });
  }, []);

  const handleMouseLeave = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ x: offset.x, y: offset.y }}
      transition={{ type: 'spring', stiffness: 250, damping: 18 }}
      style={{ width: '100%' }}
    >
      {children}
    </motion.div>
  );
}

/* ── Framer Motion animation variants ───────────────────────────────────── */
const fadeSlideUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (delay = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94], delay },
  }),
};

/* ── Hero Section ───────────────────────────────────────────────────────── */
function HeroSection({ searchValue, setSearchValue, isDesktop }) {
  const navigate = useNavigate();
  const [isFocused, setIsFocused] = useState(false);
  const [sourceCounts, setSourceCounts] = useState(null);
  const [totalListings, setTotalListings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/ingestion/status`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        if (cancelled) return;
        setTotalListings(data.total_listings_all ?? data.total_listings ?? 0);
        setSourceCounts(data.by_source ?? {});
      })
      .catch(() => {
        if (cancelled) return;
        setTotalListings(0);
        setSourceCounts({});
      });
    return () => { cancelled = true; };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      navigate(`/app${searchValue ? `?q=${encodeURIComponent(searchValue)}` : ''}`);
    }
  };

  const formatCount = (n) => {
    if (n == null) return '—';
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  };

  return (
    <section style={{
      position: 'relative',
      overflow: 'hidden',
      minHeight: 'calc(100vh - 56px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      textAlign: 'center',
      padding: '40px 24px 4px',
      background: '#0B0B0B',
    }}>

      {/* Radial amber glow behind search bar */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -30%)',
        width: 700,
        height: 500,
        background: 'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(232,160,32,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* Radar animation */}
      <RadarAnimation size={480} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* Badge — DM Mono with gold shimmer */}
        <motion.p
          className="hero-badge-shimmer"
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          custom={0}
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            marginBottom: 20,
          }}
        >
          Rental Search Engine
        </motion.p>

        {/* Headline — Playfair Display Light/Italic */}
        <motion.h1
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          custom={0.12}
          style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 300,
            fontStyle: 'italic',
            fontSize: isDesktop ? 56 : 38,
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            marginBottom: 20,
            maxWidth: 720,
            color: '#F0EFE9',
          }}
        >
          Rental Intelligence for{' '}
          <span style={{ color: '#E8A020' }}>Bangalore</span>
        </motion.h1>

        {/* Sub-heading — Inter */}
        <motion.p
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          custom={0.24}
          style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 300,
            color: '#888',
            fontSize: isDesktop ? 15 : 14,
            lineHeight: 1.85,
            letterSpacing: '0.015em',
            marginBottom: 44,
            maxWidth: 520,
            textAlign: 'center',
          }}
        >
          The first search engine for the Bangalore renter. We index the entire
          market, from major listing portals to community leads—into one
          intelligent, scored feed.
        </motion.p>

        {/* Command-palette search bar */}
        <motion.div
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          custom={0.38}
          style={{ width: '100%', maxWidth: isDesktop ? 600 : '100%', position: 'relative', marginBottom: 14 }}
        >
          <MagneticSearchBar>
            <motion.div
              className="hero-search-bar"
              animate={isFocused ? {
                boxShadow: [
                  '0 0 0 1px #333, 0 0 20px rgba(232,160,32,0.08)',
                  '0 0 0 1px #444, 0 0 32px rgba(232,160,32,0.14)',
                  '0 0 0 1px #333, 0 0 20px rgba(232,160,32,0.08)',
                ],
              } : {
                boxShadow: '0 0 0 1px #333, 0 0 0px rgba(232,160,32,0)',
              }}
              transition={isFocused ? {
                duration: 2.4,
                repeat: Infinity,
                ease: 'easeInOut',
              } : { duration: 0.3 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 58,
                padding: '0 8px 0 20px',
                background: '#141414',
                border: '1px solid #333',
                borderRadius: 14,
                position: 'relative',
              }}
            >
              {/* ⌘ icon */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                marginRight: 12,
                color: '#555',
                fontSize: 15,
              }}>
                <i className="fa-solid fa-magnifying-glass" />
              </div>

              <input
                type="text"
                placeholder="Whitefield, HSR Layout, Korama..."
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#F0EFE9',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 14,
                  padding: 0,
                  minWidth: 0,
                  letterSpacing: '0.01em',
                }}
              />

              {/* Shortcut hint */}
              <div style={{
                display: isDesktop ? 'flex' : 'none',
                alignItems: 'center',
                gap: 4,
                marginLeft: 12,
                flexShrink: 0,
              }}>
                <kbd style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  color: '#555',
                  background: '#1e1e1e',
                  border: '1px solid #333',
                  borderRadius: 5,
                  padding: '2px 7px',
                  lineHeight: '18px',
                }}>↵</kbd>
              </div>

              <Link
                to={`/app${searchValue ? `?q=${encodeURIComponent(searchValue)}` : ''}`}
                style={{
                  background: '#E8A020',
                  color: '#0A0A0A',
                  fontFamily: "'DM Mono', monospace",
                  fontWeight: 700,
                  fontSize: 12,
                  padding: '0 20px',
                  height: 42,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  marginLeft: 8,
                  letterSpacing: '0.02em',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                Search
              </Link>
            </motion.div>
          </MagneticSearchBar>
        </motion.div>

        {/* Micro-copy */}
        <motion.p
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          custom={0.48}
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            color: '#555',
            marginBottom: 48,
            letterSpacing: '0.01em',
          }}
        >
          One search across every platform.
        </motion.p>

        {/* Live source stats */}
        <motion.div
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          custom={0.58}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: '#555',
          }}>
            <span style={{
              width: 4, height: 4,
              borderRadius: '50%',
              background: '#E8A020',
              boxShadow: '0 0 6px rgba(232,160,32,0.6)',
              flexShrink: 0,
            }} />
            {totalListings != null && totalListings > 0 ? (
              <>
                Indexing{' '}
                <span style={{
                  color: '#E8A020',
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                  padding: '0 1px',
                }}>
                  {formatCount(totalListings)}+
                </span>
                {' '}listings across
              </>
            ) : (
              <>Indexing listings across</>
            )}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}>
            {SOURCE_DEFS.map(src => {
              const count = src.comingSoon ? null : sourceCounts?.[src.id]?.total_count;
              return (
                <div
                  key={src.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: `1px solid ${src.color}30`,
                    background: `${src.color}08`,
                    opacity: src.comingSoon ? 0.5 : 1,
                  }}
                >
                  <i className={src.icon} style={{ fontSize: 12, color: src.color }} />
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    color: src.color,
                    letterSpacing: '0.03em',
                  }}>
                    {src.label}
                  </span>
                  {src.comingSoon ? (
                    <span style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 9,
                      color: '#555',
                      marginLeft: 2,
                      fontStyle: 'italic',
                    }}>
                      soon
                    </span>
                  ) : count != null && (
                    <span style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      color: '#666',
                      marginLeft: 2,
                    }}>
                      {formatCount(count)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ── Signal Nodes for the fusion animation ──────────────────────────────── */
const SIGNAL_NODES = [
  { id: 0, label: 'Reddit Sentiment',  icon: 'fa-brands fa-reddit',    color: '#ff4500', x: -38, y: -42, driftX: 8,  driftY: -6  },
  { id: 1, label: 'NoBroker Lead',     icon: 'fa-solid fa-building',   color: '#e63946', x: 32,  y: -36, driftX: -5, driftY: 8   },
  { id: 2, label: 'Telegram Source',   icon: 'fa-brands fa-telegram',  color: '#229ed9', x: -44, y: 10,  driftX: 6,  driftY: 5   },
  { id: 3, label: 'Avg. Deposit',      icon: 'fa-solid fa-indian-rupee-sign', color: '#22c55e', x: 40, y: 8, driftX: -7, driftY: -4 },
  { id: 4, label: 'Commute Score',     icon: 'fa-solid fa-route',      color: '#f59e0b', x: -30, y: 38,  driftX: 4,  driftY: -7  },
  { id: 5, label: 'Market Trend',      icon: 'fa-solid fa-chart-line', color: '#06b6d4', x: 36,  y: 40,  driftX: -6, driftY: 6   },
  { id: 6, label: 'Housing.com',       icon: 'fa-solid fa-house',      color: '#7c3aed', x: 0,   y: -48, driftX: 3,  driftY: 9   },
  { id: 7, label: 'Locality Intel',    icon: 'fa-solid fa-map-pin',    color: '#ec4899', x: -2,  y: 46,  driftX: -4, driftY: -5  },
  { id: 8, label: 'Broker Check',      icon: 'fa-solid fa-user-check', color: '#8b5cf6', x: 48,  y: -14, driftX: -8, driftY: 3   },
  { id: 9, label: 'Price History',     icon: 'fa-solid fa-clock-rotate-left', color: '#14b8a6', x: -48, y: -18, driftX: 7, driftY: 4 },
];

/* ── Animated score counter ─────────────────────────────────────────────── */
function AnimatedScore({ target, trigger }) {
  const isInteger = Number.isInteger(target);
  const [display, setDisplay] = useState(isInteger ? '0' : '0.0');

  useEffect(() => {
    if (!trigger) {
      setDisplay(isInteger ? '0' : '0.0');
      return;
    }
    const controls = animate(0, target, {
      duration: 1.4,
      ease: [0.25, 0.46, 0.45, 0.94],
      onUpdate: v => setDisplay(isInteger ? Math.round(v).toString() : v.toFixed(1)),
    });
    return () => controls.stop();
  }, [trigger, target, isInteger]);

  return <>{display}</>;
}

/* ── SVG circle that draws its stroke via pathLength ────────────────────── */
function AnimatedScoreCircle({ trigger, size = 68, score = 92 }) {
  const r = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;
  const filledOffset = circumference * (1 - score / 100);

  return (
    <svg
      width={size}
      height={size}
      style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#E8A020"
        strokeWidth="2"
        strokeLinecap="round"
        style={{
          strokeDasharray: circumference,
          strokeDashoffset: trigger ? filledOffset : circumference,
          transition: 'stroke-dashoffset 1.4s cubic-bezier(0.25,0.46,0.45,0.94)',
          filter: 'drop-shadow(0 0 8px rgba(232,160,32,0.35))',
        }}
      />
    </svg>
  );
}

/* ── Unified Intelligence Section ───────────────────────────────────────── */
function UnifiedIntelligenceSection({ isDesktop }) {
  const fusionRef = useRef(null);
  const fusionInView = useInView(fusionRef, { margin: '-120px' });

  const [phase, setPhase] = useState('idle');
  useEffect(() => {
    if (fusionInView) {
      setPhase('converging');
      const t1 = setTimeout(() => setPhase('fused'), 1200);
      return () => clearTimeout(t1);
    } else {
      setPhase('idle');
    }
  }, [fusionInView]);

  const converging = phase === 'converging' || phase === 'fused';
  const fused = phase === 'fused';

  const targetRef = useRef(null);
  const targetInView = useInView(targetRef, { once: true, margin: '-60px' });

  return (
    <section style={{
      background: '#0B0B0B',
      padding: isDesktop ? '100px 24px 80px' : '72px 20px 64px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* ── 1. The Fragmentation ── */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ textAlign: 'center', marginBottom: isDesktop ? 80 : 56 }}
        >
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 300,
            fontSize: isDesktop ? 36 : 26,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: '#F0EFE9',
            marginBottom: 24,
          }}>
            The search is scattered.<br />
            The process is broken.
          </h2>
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 300,
            fontSize: isDesktop ? 15 : 14,
            lineHeight: 1.85,
            color: '#777',
            maxWidth: 540,
            margin: '0 auto',
            letterSpacing: '0.01em',
          }}>
            House hunting in Bangalore shouldn't feel like a data entry job. Right
            now, you're forced to manually monitor multiple platforms daily,
            juggling tabs just to keep track of what you've already seen. Most
            listings tell you about the four walls, but leave you in the dark about
            the context that actually matters.
          </p>
        </motion.div>

        {/* ── 2. The Transition ── */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 }}
          style={{ textAlign: 'center', marginBottom: isDesktop ? 72 : 48 }}
        >
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 300,
            fontSize: isDesktop ? 32 : 24,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: '#E8A020',
            marginBottom: 20,
          }}>
            One search. Every platform.
          </h2>
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 300,
            fontSize: isDesktop ? 15 : 14,
            lineHeight: 1.85,
            color: '#777',
            maxWidth: 520,
            margin: '0 auto',
            letterSpacing: '0.01em',
          }}>
            NestIQ pulls the scattered pieces into a single, intelligent lens. We
            don't just show you a listing; we score it against the market using
            real-time data and community sentiment from people who actually live
            there.
          </p>
        </motion.div>

        {/* ── 3. Signal Fusion ── */}
        <div
          ref={fusionRef}
          style={{
            position: 'relative',
            height: isDesktop ? 400 : 320,
            marginBottom: isDesktop ? 64 : 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Dark grid background with overflow hidden to clip nodes */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 16,
            background: '#111',
            border: '1px solid #1e1e1e',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(rgba(232,160,32,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(232,160,32,0.04) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }} />

            {/* Constellation lines — static, fade out on converge */}
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
            >
              {SIGNAL_NODES.slice(0, 8).map((node, i) => {
                const next = SIGNAL_NODES[(i + 1) % 8];
                return (
                  <line
                    key={`line-${i}`}
                    x1={50 + node.x * 0.8}
                    y1={50 + node.y * 0.8}
                    x2={50 + next.x * 0.8}
                    y2={50 + next.y * 0.8}
                    stroke="#E8A020"
                    strokeWidth="0.12"
                    opacity={converging ? 0 : 0.25}
                    style={{ transition: 'opacity 0.8s ease' }}
                  />
                );
              })}
            </svg>
          </div>

          {/* Floating signal nodes — positioned relative to center, inside the box */}
          {SIGNAL_NODES.map((node, i) => (
            <motion.div
              key={node.id}
              initial={{ x: node.x * 2.8, y: node.y * 2.8, opacity: 0 }}
              animate={converging
                ? { x: 0, y: 0, opacity: 0, filter: 'blur(6px) brightness(1.6)' }
                : { x: node.x * 2.8, y: node.y * 2.8, opacity: 1, filter: 'blur(0px) brightness(1)' }
              }
              transition={{
                duration: converging ? 1.0 : 0.6,
                delay: converging ? i * 0.06 : 0.05 * i,
                ease: converging ? [0.45, 0, 0.15, 1] : [0.25, 0.46, 0.45, 0.94],
              }}
              whileInView={!converging ? { opacity: 1 } : undefined}
              viewport={{ once: true }}
              style={{
                position: 'absolute',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 8,
                background: `${node.color}12`,
                border: `1px solid ${node.color}30`,
              }}
            >
              <i className={node.icon} style={{ fontSize: 11, color: node.color }} />
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: node.color,
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
              }}>
                {node.label}
              </span>
            </motion.div>
          ))}

          {/* Amber glow behind card */}
          <motion.div
            animate={fused
              ? { opacity: 1, scale: 1.2 }
              : { opacity: 0, scale: 0.5 }
            }
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              width: 340,
              height: 220,
              borderRadius: '50%',
              background: 'radial-gradient(ellipse, rgba(232,160,32,0.14) 0%, transparent 70%)',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          />

          {/* NestIQ Intelligence Card — blooms after fusion */}
          <motion.div
            animate={fused
              ? { opacity: 1, scale: 1 }
              : { opacity: 0, scale: 0.8 }
            }
            transition={fused
              ? { type: 'spring', stiffness: 180, damping: 16, delay: 0.15 }
              : { duration: 0.3 }
            }
            style={{
              position: 'relative',
              zIndex: 3,
              background: '#161616',
              border: '1px solid #2a2a2a',
              borderRadius: 16,
              padding: isDesktop ? '28px 36px' : '24px 28px',
              display: 'flex',
              alignItems: 'center',
              gap: isDesktop ? 24 : 18,
              boxShadow: fused
                ? '0 0 80px rgba(232,160,32,0.12), 0 0 30px rgba(232,160,32,0.06)'
                : 'none',
            }}
          >
            {/* Quality Score circle with draw animation */}
            <div style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(232,160,32,0.15) 0%, rgba(232,160,32,0.04) 70%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              position: 'relative',
            }}>
              <AnimatedScoreCircle trigger={fused} size={68} />
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 22,
                fontWeight: 500,
                color: '#E8A020',
                letterSpacing: '-0.03em',
                position: 'relative',
                zIndex: 1,
              }}>
                <AnimatedScore target={92} trigger={fused} />
              </span>
            </div>

            {/* Listing preview */}
            <div style={{ minWidth: 0 }}>
              <p style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: '#E8A020',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Quality Score
              </p>
              <p style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: isDesktop ? 14 : 13,
                color: '#F0EFE9',
                fontWeight: 400,
                marginBottom: 6,
                lineHeight: 1.4,
              }}>
                Spacious 2BHK with Balcony
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#666' }}>
                  HSR Layout
                </span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#555' }}>•</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#F0EFE9', fontWeight: 500 }}>
                  ₹32,000
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── 4. The Target Hook ── */}
        <motion.div
          ref={targetRef}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{
            padding: isDesktop ? '96px 24px' : '72px 20px',
            textAlign: 'center',
          }}
        >
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 300,
            fontSize: isDesktop ? 18 : 16,
            lineHeight: 1.8,
            color: '#A1A1AA',
            maxWidth: 520,
            margin: '0 auto',
            letterSpacing: '0.01em',
          }}>
            Built for every renter, from the newcomer to the city veteran - who
            values their time as much as their home.
          </p>
        </motion.div>

      </div>
    </section>
  );
}

/* ── Locality drill-down signals ─────────────────────────────────────────── */
const LOCALITY_SIGNALS = [
  'Infrastructure Stability',
  'Commute Score',
  'Community Sentiment',
];

/* ── Urban Intelligence Section (Pulse Preview) ────────────────────────── */
function PulseSpotlightSection({ isDesktop }) {
  const cardsRef = useRef(null);
  const cardsInView = useInView(cardsRef, { once: true, margin: '-100px' });

  const [countsReady, setCountsReady] = useState(false);
  const [signalsShown, setSignalsShown] = useState(0);

  useEffect(() => {
    if (!cardsInView) return;
    const t1 = setTimeout(() => setCountsReady(true), 500);
    const timers = [t1];
    LOCALITY_SIGNALS.forEach((_, i) => {
      timers.push(setTimeout(() => setSignalsShown(i + 1), 1400 + i * 250));
    });
    return () => timers.forEach(clearTimeout);
  }, [cardsInView]);

  const monoLabel = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: '#555',
  };

  const cardBase = {
    background: '#0a0a0a',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: isDesktop ? '28px 32px' : '24px 20px',
    flex: 1,
    minWidth: 0,
  };

  return (
    <section style={{
      background: '#050505',
      padding: isDesktop ? '120px 24px' : '80px 20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Headline + Copy */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ textAlign: 'center', marginBottom: isDesktop ? 72 : 48 }}
        >
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 300,
            fontSize: isDesktop ? 36 : 26,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: '#F0EFE9',
            marginBottom: 24,
          }}>
            Total clarity. Every neighborhood.
          </h2>
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 300,
            fontSize: isDesktop ? 15 : 14,
            lineHeight: 1.85,
            color: '#777',
            maxWidth: 540,
            margin: '0 auto',
            letterSpacing: '0.01em',
          }}>
            From city-wide rental trends to the specific pulse of a single street.
            We aggregate data across Bangalore to give you a complete picture of
            where the market is moving and what residents are saying.
          </p>
        </motion.div>

        {/* Two-card data preview */}
        <div
          ref={cardsRef}
          style={{
            display: 'flex',
            flexDirection: isDesktop ? 'row' : 'column',
            gap: 16,
            marginBottom: isDesktop ? 56 : 40,
          }}
        >
          {/* ── Left: City Overview ── */}
          <motion.div
            animate={cardsInView
              ? { opacity: 1, x: 0 }
              : { opacity: 0, x: -40 }
            }
            transition={{ duration: 0.8, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={cardBase}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <p style={monoLabel}>Bengaluru Overview</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="pulse-live-dot" style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#E8A020', display: 'inline-block',
                }} />
                <span style={{ ...monoLabel, color: '#E8A020', letterSpacing: '0.1em' }}>Live</span>
              </div>
            </div>

            {/* Avg Rent */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ ...monoLabel, marginBottom: 8 }}>Average Rent (2BHK)</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 28,
                  fontWeight: 500,
                  color: '#F0EFE9',
                  letterSpacing: '-0.03em',
                }}>
                  ₹<AnimatedScore target={34} trigger={countsReady} />k
                </span>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  color: '#E8A020',
                }}>
                  +<AnimatedScore target={3.2} trigger={countsReady} />%
                </span>
              </div>
              {/* Mini sparkline */}
              <svg width="100%" height="32" viewBox="0 0 200 32" style={{ marginTop: 8, opacity: 0.5 }}>
                <polyline
                  points="0,28 20,24 40,26 60,20 80,22 100,16 120,18 140,12 160,14 180,8 200,10"
                  fill="none"
                  stroke="#E8A020"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E8A020" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#E8A020" stopOpacity="0" />
                </linearGradient>
                <polygon
                  points="0,28 20,24 40,26 60,20 80,22 100,16 120,18 140,12 160,14 180,8 200,10 200,32 0,32"
                  fill="url(#sparkGrad)"
                />
              </svg>
            </div>

            {/* City Sentiment */}
            <div>
              <p style={{ ...monoLabel, marginBottom: 8 }}>City Sentiment</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 22,
                  fontWeight: 500,
                  color: '#10b981',
                  letterSpacing: '-0.02em',
                }}>
                  <AnimatedScore target={72} trigger={countsReady} />%
                </span>
                <span style={{ ...monoLabel, color: '#666', letterSpacing: '0.06em' }}>Positive</span>
              </div>
              {/* Sentiment bar */}
              <div style={{
                marginTop: 10,
                height: 3,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.04)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: countsReady ? '72%' : '0%',
                  borderRadius: 2,
                  background: 'linear-gradient(90deg, #10b981, #059669)',
                  transition: 'width 1.4s cubic-bezier(0.25,0.46,0.45,0.94)',
                }} />
              </div>
            </div>
          </motion.div>

          {/* ── Right: Locality Drill-down ── */}
          <motion.div
            animate={cardsInView
              ? { opacity: 1, x: 0 }
              : { opacity: 0, x: 40 }
            }
            transition={{ duration: 0.8, delay: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={cardBase}
          >
            <p style={{ ...monoLabel, marginBottom: 24 }}>Locality Deep-Dive</p>

            {/* Sentiment score ring */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginBottom: 24,
              padding: '16px 18px',
              borderRadius: 12,
              background: 'rgba(16,185,129,0.04)',
              border: '1px solid rgba(16,185,129,0.08)',
            }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)',
              }}>
                <svg width={56} height={56} style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
                  <circle cx={28} cy={28} r={24} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
                  <circle cx={28} cy={28} r={24} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round"
                    style={{
                      strokeDasharray: 2 * Math.PI * 24,
                      strokeDashoffset: countsReady ? 2 * Math.PI * 24 * 0.2 : 2 * Math.PI * 24,
                      transition: 'stroke-dashoffset 1.4s cubic-bezier(0.25,0.46,0.45,0.94)',
                      filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.3))',
                    }}
                  />
                </svg>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 16,
                  fontWeight: 500,
                  color: '#10b981',
                  position: 'relative',
                  zIndex: 1,
                }}>
                  +<AnimatedScore target={0.8} trigger={countsReady} />
                </span>
              </div>
              <div>
                <p style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 13,
                  color: '#F0EFE9',
                  fontWeight: 500,
                  marginBottom: 4,
                }}>
                  Koramangala
                </p>
                <p style={{ ...monoLabel, color: '#10b981' }}>High Sentiment Area</p>
              </div>
            </div>

            {/* Signal markers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {LOCALITY_SIGNALS.map((signal, i) => (
                <motion.div
                  key={signal}
                  animate={i < signalsShown
                    ? { opacity: 1, x: 0 }
                    : { opacity: 0, x: -10 }
                  }
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#10b981' }}>✓</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#888', letterSpacing: '0.03em' }}>
                    {signal}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Powered by Gemini */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 5 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.1em', color: '#333', textTransform: 'uppercase' }}>
                Powered by Gemini
              </span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#333" />
              </svg>
            </div>
          </motion.div>
        </div>

        {/* CTA Button */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.7, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ textAlign: 'center' }}
        >
          <Link
            to="/locality-guide"
            className="pulse-cta-btn"
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#E8A020',
              padding: '15px 34px',
              borderRadius: 10,
              border: '1px solid rgba(232,160,32,0.2)',
              background: 'transparent',
              textDecoration: 'none',
              overflow: 'hidden',
              transition: 'color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(232,160,32,0.5)';
              e.currentTarget.style.boxShadow = '0 0 28px rgba(232,160,32,0.1), inset 0 0 20px rgba(232,160,32,0.03)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(232,160,32,0.2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {/* Hover fill gradient */}
            <span className="pulse-cta-fill" />
            <span style={{ position: 'relative', zIndex: 1, transition: 'transform 0.3s ease' }} className="pulse-cta-text">
              Explore the Bangalore Pulse
            </span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ position: 'relative', zIndex: 1, flexShrink: 0, transition: 'transform 0.3s ease' }} className="pulse-cta-icon">
              <path d="M4 12L12 4M12 4H5M12 4V11" stroke="#E8A020" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {/* Scanning line */}
            <span className="pulse-cta-scan" />
          </Link>
        </motion.div>

      </div>
    </section>
  );
}

/* ── My Hub Section ─────────────────────────────────────────────────────── */
const HUB_STAGES = ['Interested', 'Contacted', 'Visited'];

function MyHubSection({ isDesktop }) {
  return (
    <section style={{
      background: '#0B0B0B',
      padding: isDesktop ? '120px 24px' : '80px 20px',
      position: 'relative',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* ── Benefit 1: Progress Tracker ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ marginBottom: isDesktop ? 80 : 56 }}
        >
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 300,
            fontSize: isDesktop ? 32 : 24,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: '#F0EFE9',
            marginBottom: 18,
            textAlign: 'center',
          }}>
            Track every liked house.
          </h2>
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 300,
            fontSize: isDesktop ? 15 : 14,
            lineHeight: 1.85,
            color: '#777',
            maxWidth: 480,
            margin: '0 auto 32px',
            textAlign: 'center',
            letterSpacing: '0.01em',
          }}>
            Organize the listings you've saved into stages: Interested, Contacted,
            or Visited. Keep your notes and outreach in one place so you know
            exactly where you stand with every landlord.
          </p>

          {/* Stage toggle buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}>
            {HUB_STAGES.map((stage, i) => {
              const active = i === 1;
              return (
                <div
                  key={stage}
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    padding: '10px 22px',
                    borderRadius: 8,
                    border: `1px solid ${active ? 'rgba(232,160,32,0.5)' : 'rgba(255,255,255,0.06)'}`,
                    background: active ? 'rgba(232,160,32,0.08)' : 'rgba(255,255,255,0.02)',
                    color: active ? '#E8A020' : '#555',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {stage}
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* ── Benefit 2: New Lead Alerts ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ marginBottom: isDesktop ? 72 : 48 }}
        >
          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 300,
            fontSize: isDesktop ? 32 : 24,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: '#F0EFE9',
            marginBottom: 18,
            textAlign: 'center',
          }}>
            Catch new leads early.
          </h2>
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 300,
            fontSize: isDesktop ? 15 : 14,
            lineHeight: 1.85,
            color: '#777',
            maxWidth: 480,
            margin: '0 auto 32px',
            textAlign: 'center',
            letterSpacing: '0.01em',
          }}>
            The 'New Leads' tab automatically gathers fresh listings from the last
            24 hours across all platforms, ensuring you're always first to see the
            latest availability.
          </p>

          {/* New Leads badge */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 24px',
              borderRadius: 10,
              background: '#111',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <i className="fa-solid fa-bolt" style={{ fontSize: 12, color: '#E8A020' }} />
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#F0EFE9',
              }}>
                New Leads
              </span>
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                fontWeight: 500,
                color: '#0A0A0A',
                background: '#E8A020',
                borderRadius: 10,
                padding: '2px 8px',
                lineHeight: '16px',
              }}>
                6
              </span>
            </div>
          </div>
        </motion.div>

        {/* ── CTA ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{ textAlign: 'center' }}
        >
          <Link
            to="/new"
            className="pulse-cta-btn"
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#E8A020',
              padding: '15px 34px',
              borderRadius: 10,
              border: '1px solid rgba(232,160,32,0.2)',
              background: 'transparent',
              textDecoration: 'none',
              overflow: 'hidden',
              transition: 'color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(232,160,32,0.5)';
              e.currentTarget.style.boxShadow = '0 0 28px rgba(232,160,32,0.1), inset 0 0 20px rgba(232,160,32,0.03)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(232,160,32,0.2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span className="pulse-cta-fill" />
            <span style={{ position: 'relative', zIndex: 1, transition: 'transform 0.3s ease' }} className="pulse-cta-text">
              Explore My Hub
            </span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ position: 'relative', zIndex: 1, flexShrink: 0, transition: 'transform 0.3s ease' }} className="pulse-cta-icon">
              <path d="M4 12L12 4M12 4H5M12 4V11" stroke="#E8A020" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="pulse-cta-scan" />
          </Link>
        </motion.div>

      </div>
    </section>
  );
}

/* ── FAQ Data ───────────────────────────────────────────────────────────── */
const FAQ_ITEMS = [
  {
    q: 'Is NestIQ a rental platform?',
    a: 'No. NestIQ is a search engine for rentals. We don\'t host our own listings; we index the web to help you find the best ones from NoBroker, 99acres, Reddit, and more in one place.',
  },
  {
    q: 'Is it free to use?',
    a: 'Yes, completely. We believe rental intelligence should be accessible to every renter in Bangalore.',
  },
  {
    q: 'How are the IQ Scores and Sentiment Analysis calculated?',
    a: 'Our engine evaluates every listing across three core pillars: Market Fit (benchmarking rent against actual neighborhood averages), Locality Score (factoring in community sentiment and infrastructure stability), and Listing Detail (analyzing the depth and transparency of the information provided). The Pulse then layers this with real-time sentiment from thousands of social signals to give you the true \'vibe\' of a neighborhood.',
  },
  {
    q: 'Can I book a house directly on NestIQ?',
    a: 'You cannot. We provide the intelligence and the scoring to help you decide, but the actual booking happens on the source platform. We simply give you the cleanest, fastest path to get there.',
  },
  {
    q: 'Why use NestIQ instead of just checking NoBroker?',
    a: 'Because NoBroker is just one piece of the puzzle. NestIQ gives you the entire landscape—including social community leads and locality sentiment—so you don\'t miss out on the perfect home just because it was posted on a different tab.',
  },
  {
    q: 'Are you competing with existing rental companies?',
    a: 'Actually, we support them. By making listings easier to discover and providing better context, we drive higher-quality traction to the original platforms while making the renter\'s life significantly easier.',
  },
];

/* ── FAQ Accordion Row ──────────────────────────────────────────────────── */
function FaqRow({ item, isOpen, onToggle }) {
  return (
    <div style={{
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      background: isOpen ? 'rgba(255,255,255,0.02)' : 'transparent',
      transition: 'background 0.3s ease',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '22px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          gap: 16,
        }}
      >
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: isOpen ? '#E8A020' : '#999',
          transition: 'color 0.25s ease',
          flex: 1,
        }}>
          {item.q}
        </span>
        <motion.span
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 16,
            color: isOpen ? '#E8A020' : '#555',
            flexShrink: 0,
            lineHeight: 1,
            transition: 'color 0.25s ease',
          }}
        >
          +
        </motion.span>
      </button>
      <motion.div
        initial={false}
        animate={{
          height: isOpen ? 'auto' : 0,
          opacity: isOpen ? 1 : 0,
        }}
        transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ overflow: 'hidden' }}
      >
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 300,
          fontSize: 14,
          lineHeight: 1.8,
          color: '#777',
          paddingBottom: 22,
          maxWidth: 580,
        }}>
          {item.a}
        </p>
      </motion.div>
    </div>
  );
}

/* ── FAQ Section ────────────────────────────────────────────────────────── */
function FaqSection({ isDesktop }) {
  const [openIdx, setOpenIdx] = useState(null);

  return (
    <section style={{
      background: '#0B0B0B',
      padding: isDesktop ? '120px 24px' : '80px 20px',
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
          style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 300,
            fontSize: isDesktop ? 34 : 26,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: '#F0EFE9',
            textAlign: 'center',
            marginBottom: isDesktop ? 56 : 40,
          }}
        >
          FAQs
        </motion.h2>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {FAQ_ITEMS.map((item, i) => (
            <FaqRow
              key={i}
              item={item}
              isOpen={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? null : i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const [searchValue, setSearchValue] = useState('');
  const isDesktop = useDesktop();

  return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, paddingBottom: isDesktop ? 40 : 80 }}>
      <DesktopSidebar />

      <AppHeader transparent />

      {/* ── HERO ── */}
      <HeroSection searchValue={searchValue} setSearchValue={setSearchValue} isDesktop={isDesktop} />

      <SectionDivider />

      {/* ── UNIFIED INTELLIGENCE ── */}
      <UnifiedIntelligenceSection isDesktop={isDesktop} />

      <SectionDivider />

      {/* ── PULSE SPOTLIGHT ── */}
      <PulseSpotlightSection isDesktop={isDesktop} />

      <SectionDivider />

      {/* ── MY HUB ── */}
      <MyHubSection isDesktop={isDesktop} />

      <SectionDivider />

      {/* ── FAQ ── */}
      <FaqSection isDesktop={isDesktop} />

      <SectionDivider />

      {/* ── FOOTER CTA ── */}
      <section style={{
        padding: '80px 24px 140px',
        textAlign: 'center',
        background: 'radial-gradient(ellipse 60% 50% at 50% 100%, rgba(232,160,32,0.07) 0%, transparent 70%)',
      }}>
        <h2 style={{ fontWeight: 300, fontSize: 30, letterSpacing: '-0.025em', marginBottom: 10 }}>
          Start your smartest home search.
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.12em', marginBottom: 32, textTransform: 'uppercase' }}>
          Free · Intelligence-first rental search
        </p>
        <Link
          to="/app"
          className="pulse-cta-btn"
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#E8A020',
            padding: '15px 34px',
            borderRadius: 10,
            border: '1px solid rgba(232,160,32,0.2)',
            background: 'transparent',
            textDecoration: 'none',
            overflow: 'hidden',
            transition: 'color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(232,160,32,0.5)';
            e.currentTarget.style.boxShadow = '0 0 30px -6px rgba(232,160,32,0.25)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'rgba(232,160,32,0.2)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <span className="pulse-cta-fill" />
          <span style={{ position: 'relative', zIndex: 1, transition: 'transform 0.3s ease' }} className="pulse-cta-text">
            Start Search
          </span>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ position: 'relative', zIndex: 1, flexShrink: 0, transition: 'transform 0.3s ease' }} className="pulse-cta-icon">
            <path d="M4 12L12 4M12 4H5M12 4V11" stroke="#E8A020" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="pulse-cta-scan" />
        </Link>
      </section>

      <BottomNav />

    </div>
  );
}
