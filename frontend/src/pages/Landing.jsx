import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import RadarAnimation from '../components/RadarAnimation';

const SAMPLE_LISTINGS = [
  { score: '9.2', title: 'Spacious 2BHK with Balcony', location: 'HSR Sect 2', price: '₹32,000', source: 'Reddit' },
  { score: '8.8', title: 'Modern Studio, Fully Furnished', location: 'Indiranagar', price: '₹28,500', source: 'Telegram' },
  { score: '8.4', title: 'Semi-Furnished 3BHK Apartment', location: 'Bellandur', price: '₹45,000', source: 'NoBroker' },
];

const LOCALITY_TABS = ['Koramangala', 'Indiranagar', 'HSR Layout', 'Bellandur'];

const LOCALITY_DATA = {
  Koramangala: { trend: '+4.2%', avgRent: '₹38,000', sentiment: '82%', quote: 'Great connectivity but traffic at Sony World junction remains a pain point.' },
  Indiranagar:  { trend: '+2.8%', avgRent: '₹42,000', sentiment: '78%', quote: 'Vibrant nightlife and walkable streets. Parking is a persistent issue.' },
  'HSR Layout': { trend: '+1.9%', avgRent: '₹34,000', sentiment: '85%', quote: 'Clean, planned layout with great parks. Slightly far from the metro.' },
  Bellandur:    { trend: '+5.1%', avgRent: '₹30,000', sentiment: '71%', quote: 'Good value for money but lake stench during monsoons is a recurring complaint.' },
};

const PIPELINE_STAGES = ['Saved', 'Interested', 'Contacted', 'Visited'];

const SAVED_LISTINGS = [
  { title: 'Boutique 1BHK Penthouse', stage: 'Contacted', location: 'Koramangala 4th Block', price: '₹24,000' },
  { title: 'Luxury 2BHK Near Metro', stage: 'Visited', location: 'Indiranagar Stage 2', price: '₹42,000' },
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

export default function Landing() {
  const [activeLocality, setActiveLocality] = useState('Koramangala');
  const [searchValue, setSearchValue] = useState('');
  const isDesktop = useDesktop();

  const locality = LOCALITY_DATA[activeLocality];

  return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, paddingBottom: isDesktop ? 40 : 80 }}>
      <DesktopSidebar />

      <AppHeader transparent />

      {/* ── HERO ── */}
      <section style={{
        position: 'relative',
        overflow: 'hidden',
        minHeight: 'calc(100vh - 56px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        padding: '40px 24px 8px',
      }}>

        {/* Amber spotlight from top-center */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '180%',
          height: '70%',
          background: 'radial-gradient(ellipse 65% 55% at 50% 0%, rgba(210,145,25,0.42) 0%, rgba(170,110,15,0.22) 35%, rgba(120,75,8,0.08) 58%, transparent 75%)',
          pointerEvents: 'none',
          zIndex: 0,
        }} />

        {/* Radar animation — upper right */}
        <RadarAnimation size={480} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

          {/* Hero badge — DM Mono, animated gold shimmer */}
          <p
            className="hero-badge-shimmer"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              marginBottom: 20,
            }}
          >
            Rental Search Engine
          </p>

          {/* Headline — Playfair Display */}
          <h1 style={{
            fontFamily: "'Playfair Display', serif",
            fontWeight: 400,
            fontSize: 40,
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            marginBottom: 14,
            maxWidth: 700,
          }}>
            Rental intelligence<br />
            for{' '}
            <span style={{
              fontStyle: 'italic',
              color: '#E8A020',
            }}>
              Bangalore.
            </span>
          </h1>

          {/* Tagline — DM Mono amber */}
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.2em',
            color: '#E8A020',
            textTransform: 'uppercase',
            marginBottom: 28,
          }}>
            Search smarter, not harder.
          </p>

          {/* Description — Inter */}
          <p style={{ ...s.subtext, marginBottom: 36, maxWidth: 420, textAlign: 'center' }}>
            A search engine that scans every platform, scores every listing,
            and knows every locality.
          </p>

          {/* Search pill */}
          <div style={{ width: '100%', maxWidth: isDesktop ? 560 : 340, position: 'relative', marginBottom: 12 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              height: 54,
              padding: 6,
              background: 'rgba(17,17,17,0.80)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '0.5px solid rgba(232,160,32,0.20)',
              borderRadius: 9999,
              overflow: 'hidden',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05)',
              position: 'relative',
            }}>

              {/* Location icon */}
              <div style={{ paddingLeft: 16, paddingRight: 8, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <i className="fa-solid fa-location-dot" style={{ color: '#E8A020', fontSize: 16 }} />
              </div>

              {/* Input */}
              <input
                type="text"
                placeholder="Whitefield, HSR Layout, Korama..."
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#F0EFE9',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  padding: 0,
                  minWidth: 0,
                }}
              />

              {/* Search button */}
              <Link
                to={`/app${searchValue ? `?q=${encodeURIComponent(searchValue)}` : ''}`}
                style={{
                  background: '#E8A020',
                  color: '#0A0A0A',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: 12,
                  padding: '0 20px',
                  alignSelf: 'stretch',
                  borderRadius: 9999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 0 12px rgba(232,160,32,0.3)',
                  flexShrink: 0,
                  letterSpacing: '0.01em',
                }}
              >
                Search →
              </Link>
            </div>
          </div>

          {/* Popular links */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 8px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(102,102,102,0.5)' }}>Popular:</span>
            {['Koramangala', 'HSR Layout', 'Whitefield'].map((loc, i) => (
              <React.Fragment key={loc}>
                <Link
                  to={`/app?q=${loc}`}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#666666', textDecoration: 'none', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#E8A020')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#666666')}
                >
                  {loc}
                </Link>
                {i < 2 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(102,102,102,0.2)' }}>•</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ── PLATFORM SECTION ── */}
      <section style={s.section}>
        <h2 style={s.h2}>One search. Every platform.</h2>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 32 }}>
          {['Reddit', 'Telegram', 'NoBroker', 'Housing'].map(src => (
            <span key={src} style={s.monoTag}>{src}</span>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SAMPLE_LISTINGS.map(listing => (
            <div key={listing.title} style={{
              ...s.card,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ minWidth: 0 }}>
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.06em',
                  marginBottom: 5,
                }}>
                  {listing.location}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 400, lineHeight: 1.6, marginBottom: 10 }}>{listing.title}</p>
                <span style={s.monoTag}>{listing.source}</span>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 20 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 500,
                  fontSize: 26,
                  color: 'var(--color-amber)',
                  letterSpacing: '-0.03em',
                  lineHeight: 1,
                }}>
                  {listing.score}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  color: 'var(--color-text-primary)',
                  marginTop: 6,
                }}>
                  {listing.price}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SectionDivider />

      {/* ── PULSE SECTION ── */}
      <section style={s.section}>
        <p style={s.eyebrow}>Pulse</p>
        <h2 style={s.h2}>Know your locality before you commit.</h2>
        <p style={s.subtext}>
          Live rent averages, deposit benchmarks, and real sentiment from actual residents.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {LOCALITY_TABS.map(loc => (
            <button
              key={loc}
              onClick={() => setActiveLocality(loc)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                letterSpacing: '0.04em',
                background: activeLocality === loc ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                color: activeLocality === loc ? '#1a0a00' : 'var(--color-text-muted)',
                border: activeLocality === loc ? 'none' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-pill)',
                padding: '7px 16px',
                cursor: 'pointer',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {loc}
            </button>
          ))}
        </div>

        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <p style={{ fontWeight: 300, fontSize: 22, letterSpacing: '-0.02em', marginBottom: 4 }}>
                {activeLocality}
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-amber)' }}>
                ↑ {locality.trend} this month
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>
                {locality.avgRent}
              </p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#666666', marginTop: 2, lineHeight: 1.6 }}>
                avg / mo for 2BHK
              </p>
            </div>
          </div>

          <div style={{
            background: 'var(--color-bg-card)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
          }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              Resident Sentiment
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: 'var(--color-amber)' }}>
              {locality.sentiment} Positive
            </p>
          </div>

          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#666666', fontStyle: 'italic', lineHeight: 1.6 }}>
            "{locality.quote}"
          </p>
        </div>
      </section>

      <SectionDivider />

      {/* ── MY HUB SECTION ── */}
      <section style={s.section}>
        <p style={s.eyebrow}>My Hub</p>
        <h2 style={s.h2}>Your search, organised.</h2>
        <p style={s.subtext}>
          Save listings, track where you are, and keep all owner contacts in one central dashboard.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {PIPELINE_STAGES.map(stage => (
            <span key={stage} style={s.monoTag}>{stage}</span>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SAVED_LISTINGS.map(listing => (
            <div key={listing.title} style={{
              ...s.card,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div style={{ minWidth: 0 }}>
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--color-amber)',
                  letterSpacing: '0.06em',
                  marginBottom: 5,
                }}>
                  {listing.stage.toUpperCase()}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 400, lineHeight: 1.6, marginBottom: 4 }}>{listing.title}</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {listing.location}
                </p>
              </div>
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                flexShrink: 0,
                marginLeft: 20,
              }}>
                {listing.price}
              </p>
            </div>
          ))}
        </div>
      </section>

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
          Free · No sign-up required
        </p>
        <Link
          to="/app"
          style={{
            display: 'inline-block',
            background: 'var(--color-amber)',
            color: '#1a0a00',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: '0.04em',
            padding: '14px 36px',
            borderRadius: 8,
            textDecoration: 'none',
            boxShadow: '0 0 40px -4px rgba(232,160,32,0.28)',
            transition: 'opacity 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = '0.88';
            e.currentTarget.style.boxShadow = '0 0 56px -4px rgba(232,160,32,0.45)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.boxShadow = '0 0 40px -4px rgba(232,160,32,0.28)';
          }}
        >
          Open NestIQ →
        </Link>
      </section>

      <BottomNav />

    </div>
  );
}
