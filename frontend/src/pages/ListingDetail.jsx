import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';

// ── Static mock listing (will be replaced with API lookup by :id later) ───────
const MOCK_LISTING = {
  id: 'hsr-3bhk-001',
  source: 'NoBroker',
  sourceUrl: 'https://www.reddit.com',
  verifiedAgo: '4h ago',
  title: 'Sun-drenched Penthouse with Private Terrace in Koramangala',
  price: '₹1,15,000',
  depositMonths: 6,
  depositAmount: '₹6,90,000',
  bhk: '3 BHK',
  sqft: '2,450',
  locality: 'ST Bed, Koramangala',
  localitySlug: 'koramangala',
  score: 84,
  marketFit: 'High',
  signals: [
    { label: 'Under market price for locality', delta: +12 },
    { label: 'High walkability score (92)',      delta: +8  },
    { label: 'New construction premium',         delta: -5  },
  ],
  description: `Beautiful 3BHK penthouse located in the quiet corners of ST Bed. Huge terrace with views of the park. All rooms have attached baths and built-in wardrobes. Fully modular kitchen with chimney. Modular switches and LED lighting throughout. Looking for families or working professionals who can maintain the place well. Society maintenance included. Parking available for two-wheelers and one car. Water supply is 24/7 via borewell and BWSSB.`,
  phone: '+91 98XXX XXX42',
  localityStats: [
    { label: 'Avg Rent',        value: '₹94k' },
    { label: 'Active Listings', value: '142'  },
    { label: 'Avg Deposit',     value: '5.2×' },
    { label: 'Price Trend',     value: '+4.2%'},
  ],
  alternatives: [
    { id: 'alt-1', score: 82, title: 'Modern 2BHK Garden Flat',   price: '₹85,000' },
    { id: 'alt-2', score: 79, title: 'Luxury Studio with View',    price: '₹45,000' },
    { id: 'alt-3', score: 76, title: 'Duplex in HSR Layout',       price: '₹1,25,000'},
    { id: 'alt-4', score: 71, title: 'Independent House ST Bed',   price: '₹72,000' },
  ],
};

const PIPELINE_STAGES = ['Saved', 'Interested', 'Contacted', 'Visited'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 80) return 'var(--color-amber)';
  if (score >= 60) return 'rgba(232,160,32,0.6)';
  return 'var(--color-text-muted)';
}

function deltaColor(delta) {
  return delta >= 0 ? 'var(--color-amber)' : '#e05c5c';
}

// SVG circular score ring
function ScoreRing({ score, size = 100 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ * (score / 100);
  const cx = size / 2;

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      {/* Track */}
      <circle
        cx={cx} cy={cx} r={r}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={4}
      />
      {/* Progress */}
      <circle
        cx={cx} cy={cx} r={r}
        fill="none"
        stroke="var(--color-amber)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${fill} ${circ - fill}`}
        strokeDashoffset={0}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const s = {
  page: {
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    minHeight: '100vh',
    paddingBottom: 88,
  },
  card: {
    background: 'var(--color-bg-surface)',
    borderRadius: 'var(--radius-card)',
    padding: '18px',
  },
  sectionLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--color-amber)',
    marginBottom: 14,
  },
  monoSmall: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.06em',
    color: 'var(--color-text-muted)',
  },
  divider: {
    height: 1,
    background: 'var(--color-border)',
    margin: '16px 0',
  },
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ListingDetail() {
  const listing = MOCK_LISTING;

  const [stage, setStage]             = useState('Interested');
  const [saved, setSaved]             = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [savedAlts, setSavedAlts]     = useState(new Set());

  const descPreview = listing.description.slice(0, 200);
  const descIsTruncated = listing.description.length > 200;

  function toggleAltSave(id) {
    setSavedAlts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleCopyScript() {
    const script = `Hi, I saw your listing for ${listing.title} on NestIQ. I'm interested in viewing the property. Could you let me know a convenient time? Thank you.`;
    navigator.clipboard.writeText(script).catch(() => {});
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  }

  return (
    <div style={s.page}>

      <AppHeader backTo />

      {/* ── VERIFIED STRIP ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#4caf82',
          background: 'rgba(76,175,130,0.1)',
          border: '1px solid rgba(76,175,130,0.25)',
          borderRadius: 4, padding: '3px 8px',
        }}>
          ✓ Verified
        </span>
        <span style={{ ...s.monoSmall, fontSize: 10 }}>{listing.verifiedAgo}</span>
      </div>

      {/* ── IMAGE PLACEHOLDER ── */}
      <div style={{
        height: 220,
        background: 'var(--color-bg-surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderBottom: '1px solid var(--color-border)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Ambient gradient */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(232,160,32,0.06) 0%, transparent 70%)',
        }} />
        <div style={{ textAlign: 'center', position: 'relative' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🏙</p>
          <p style={{ ...s.monoSmall, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Photos coming soon
          </p>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0' }}>

        {/* ── TITLE + STAGE + PRICE ── */}
        <section style={{ marginBottom: 24 }}>
          {/* Stage selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
            {PIPELINE_STAGES.map(st => (
              <button
                key={st}
                onClick={() => setStage(st)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  background: stage === st ? 'rgba(232,160,32,0.15)' : 'transparent',
                  color: stage === st ? 'var(--color-amber)' : 'var(--color-text-muted)',
                  border: `1px solid ${stage === st ? 'rgba(232,160,32,0.4)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-pill)', padding: '5px 12px',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {stage === st ? '● ' : ''}{st}
              </button>
            ))}
          </div>

          <h1 style={{
            fontWeight: 300, fontSize: 22, lineHeight: 1.3,
            letterSpacing: '-0.02em', marginBottom: 16,
          }}>
            {listing.title}
          </h1>

          {/* Price block */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 500,
              color: 'var(--color-text-primary)', letterSpacing: '-0.03em',
            }}>
              {listing.price}
            </span>
            <span style={{ ...s.monoSmall }}>/mo</span>
          </div>
          <p style={{ ...s.monoSmall, fontSize: 12 }}>
            Est. Deposit: <span style={{ color: 'var(--color-text-primary)' }}>{listing.depositAmount}</span>
            {' '}({listing.depositMonths} months)
          </p>

          <div style={s.divider} />

          {/* Spec chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { icon: '🛏', label: listing.bhk },
              { icon: '⊡', label: `${listing.sqft} sqft` },
              { icon: '📍', label: listing.locality },
            ].map(spec => (
              <span key={spec.label} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                background: 'var(--color-bg-surface)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 6, padding: '6px 12px',
              }}>
                <span>{spec.icon}</span> {spec.label}
              </span>
            ))}
          </div>
        </section>

        {/* ── NESTIQ SCORE ── */}
        <section style={{ ...s.card, marginBottom: 16 }}>
          <p style={s.sectionLabel}>NestIQ Score</p>

          {/* Score display */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
            <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
              <ScoreRing score={listing.score} size={100} />
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 500,
                  color: scoreColor(listing.score), letterSpacing: '-0.03em', lineHeight: 1,
                }}>
                  {listing.score}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
                  /100
                </span>
              </div>
            </div>

            <div>
              <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                Market Fit
              </p>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500,
                color: 'var(--color-amber)',
              }}>
                {listing.marketFit}
              </p>
            </div>
          </div>

          {/* Intelligence signals */}
          <div>
            <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
              Intelligence Signals
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {listing.signals.map(sig => (
                <div key={sig.label} style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12,
                }}>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    {sig.label}
                  </p>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
                    color: deltaColor(sig.delta), flexShrink: 0,
                    letterSpacing: '0.02em',
                  }}>
                    {sig.delta > 0 ? '+' : ''}{String(Math.abs(sig.delta)).padStart(2, '0')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── DESCRIPTION ── */}
        <section style={{ ...s.card, marginBottom: 16 }}>
          <p style={s.sectionLabel}>Description</p>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.75 }}>
            {descExpanded || !descIsTruncated ? listing.description : `${descPreview}…`}
          </p>
          {descIsTruncated && (
            <button
              onClick={() => setDescExpanded(e => !e)}
              style={{
                marginTop: 10, background: 'none', border: 'none',
                cursor: 'pointer', padding: 0,
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                color: 'var(--color-amber)', transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              {descExpanded ? '↑ Show less' : '↓ Read more'}
            </button>
          )}
        </section>

        {/* ── OWNER CONTACT ── */}
        <section style={{ ...s.card, marginBottom: 16 }}>
          <p style={s.sectionLabel}>Owner Contact</p>

          {/* Phone */}
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 16,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500,
              letterSpacing: '0.04em', color: 'var(--color-text-primary)',
            }}>
              {listing.phone}
            </span>
            <a
              href={`tel:${listing.phone}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
                background: 'var(--color-amber)', color: '#1a0a00',
                border: 'none', borderRadius: 8,
                padding: '9px 18px', textDecoration: 'none', fontWeight: 500,
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              📞 Call
            </a>
          </div>

          <div style={s.divider} />

          {/* Secondary actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            <a
              href={listing.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'none', border: '1px solid var(--color-border)',
                borderRadius: 8, padding: '10px 14px',
                color: 'var(--color-text-muted)', textDecoration: 'none',
                transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-text-muted)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.color = 'var(--color-text-muted)';
              }}
            >
              Open on {listing.source} ↗
            </a>

            <button
              onClick={handleCopyScript}
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: copiedScript ? 'rgba(232,160,32,0.12)' : 'none',
                border: `1px solid ${copiedScript ? 'rgba(232,160,32,0.4)' : 'var(--color-border)'}`,
                borderRadius: 8, padding: '10px 14px',
                color: copiedScript ? 'var(--color-amber)' : 'var(--color-text-muted)',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {copiedScript ? '✓ Copied!' : '⎘ Copy Outreach Script'}
            </button>
          </div>
        </section>

        {/* ── LOCALITY INTEL ── */}
        <section style={{ marginBottom: 16 }}>
          <p style={{ ...s.sectionLabel, marginBottom: 10 }}>
            Locality Intel: {listing.locality.split(',').pop().trim()}
          </p>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8, marginBottom: 14,
          }}>
            {listing.localityStats.map(stat => (
              <div key={stat.label} style={s.card}>
                <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  {stat.label}
                </p>
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500,
                  color: 'var(--color-text-primary)', letterSpacing: '-0.02em',
                }}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <Link
            to={`/neighbourhood-pulse/${listing.localitySlug}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
              textTransform: 'uppercase', textDecoration: 'none',
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-card)', padding: '12px 16px',
              border: '1px solid var(--color-border)',
              transition: 'border-color 0.2s, color 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-amber)';
              e.currentTarget.style.color = 'var(--color-amber)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = 'var(--color-text-muted)';
            }}
          >
            View Full Intelligence Report
            <span style={{ fontSize: 14 }}>→</span>
          </Link>
        </section>

        {/* ── MARKET ALTERNATIVES ── */}
        <section style={{ marginBottom: 8 }}>
          <p style={s.sectionLabel}>Market Alternatives</p>

          <div style={{
            display: 'flex', gap: 10,
            overflowX: 'auto', scrollbarWidth: 'none',
            paddingBottom: 4,
          }}>
            {listing.alternatives.map(alt => (
              <div key={alt.id} style={{
                background: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-card)',
                padding: '14px',
                minWidth: 168, flexShrink: 0,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {/* Score + save */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 2,
                    border: '1px solid var(--color-border)', borderRadius: 5,
                    padding: '3px 8px',
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500,
                      color: scoreColor(alt.score), letterSpacing: '-0.02em',
                    }}>
                      {alt.score}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)' }}>
                      IQ
                    </span>
                  </div>
                  <button
                    onClick={() => toggleAltSave(alt.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      fontSize: 16, lineHeight: 1,
                      color: savedAlts.has(alt.id) ? 'var(--color-amber)' : 'var(--color-text-muted)',
                      transition: 'color 0.2s',
                    }}
                    aria-label="Save listing"
                  >
                    {savedAlts.has(alt.id) ? '★' : '☆'}
                  </button>
                </div>

                {/* Title */}
                <p style={{ fontWeight: 300, fontSize: 13, lineHeight: 1.4, flex: 1 }}>
                  {alt.title}
                </p>

                {/* Price */}
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
                  color: 'var(--color-text-primary)', letterSpacing: '-0.01em',
                }}>
                  {alt.price}
                </p>
              </div>
            ))}
          </div>
        </section>

      </div>

      {/* ── STICKY BOTTOM CTA ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: 'rgba(10,10,10,0.96)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid var(--color-border)',
        padding: '12px 16px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        {/* Price summary */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500,
            color: 'var(--color-text-primary)', letterSpacing: '-0.02em', lineHeight: 1,
          }}>
            {listing.price}
          </p>
          <p style={{ ...s.monoSmall, fontSize: 10, marginTop: 2 }}>
            {listing.bhk} · {listing.locality.split(',')[0]}
          </p>
        </div>

        {/* Save toggle */}
        <button
          onClick={() => setSaved(s => !s)}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
            background: 'none',
            border: `1px solid ${saved ? 'var(--color-amber)' : 'var(--color-border)'}`,
            color: saved ? 'var(--color-amber)' : 'var(--color-text-muted)',
            borderRadius: 8, padding: '10px 16px', cursor: 'pointer',
            transition: 'all 0.2s', flexShrink: 0,
          }}
        >
          {saved ? '★ Saved' : '☆ Save'}
        </button>

        {/* Primary CTA */}
        <a
          href={`tel:${listing.phone}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
            letterSpacing: '0.04em',
            background: 'var(--color-amber)', color: '#1a0a00',
            border: 'none', borderRadius: 8,
            padding: '10px 24px', textDecoration: 'none', flexShrink: 0,
            boxShadow: '0 0 24px -4px rgba(232,160,32,0.3)',
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          📞 Call Owner
        </a>
      </div>

    </div>
  );
}
