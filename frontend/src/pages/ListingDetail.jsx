import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import { supabase } from '../lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '')           // strip markdown images ![alt](url)
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')     // strip markdown links [text](url) → text
    .replace(/https?:\/\/\S+/gi, '')           // strip bare URLs
    .replace(/^#{1,6}\s+/gm, '')               // strip heading markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')        // strip bold
    .replace(/(\*|_)(.*?)\1/g, '$2')           // strip italic
    .replace(/`([^`]+)`/g, '$1')               // strip inline code
    .replace(/^\s*[-*>]\s+/gm, '')             // strip list/blockquote markers
    .replace(/\n{3,}/g, '\n\n')                // collapse excessive blank lines
    .trim();
}

function localityToSlug(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/\s+/g, '-');
}

function formatPrice(val) {
  const n = Number(val);
  if (!val || isNaN(n) || n === 0) return null;
  return `₹${n.toLocaleString('en-IN')}`;
}

function formatRentShort(n) {
  if (!n) return '—';
  const v = Number(n);
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)   return `₹${(v / 1000).toFixed(0)}k`;
  return `₹${v}`;
}

function timeAgo(epoch) {
  if (!epoch) return '';
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

function scoreColor(score) {
  if (score >= 80) return 'var(--color-amber)';
  if (score >= 60) return 'rgba(232,160,32,0.6)';
  return 'var(--color-text-muted)';
}

function deltaColor(delta) {
  return delta >= 0 ? 'var(--color-amber)' : '#e05c5c';
}

function normalizeSource(raw) {
  const map = { reddit: 'Reddit', telegram: 'Telegram', nobroker: 'NoBroker', housing: 'Housing.com', 'housing.com': 'Housing.com' };
  return map[(raw || '').toLowerCase()] || raw || 'Unknown';
}

// Derive smart signals from listing data + locality median
function deriveSignals(listing, localityMedianRent) {
  const signals = [];
  const rent = Number(listing?.price || listing?.rent);
  const median = Number(localityMedianRent);

  if (rent && median && median > 0) {
    const pctDiff = Math.round(((rent - median) / median) * 100);
    if (pctDiff <= -10) {
      const delta = Math.min(20, Math.round(Math.abs(pctDiff) / 5));
      signals.push({ label: `Under market price for locality (${Math.abs(pctDiff)}% below median)`, delta: +delta });
    } else if (pctDiff >= 10) {
      const delta = Math.min(-5, -Math.round(pctDiff / 10));
      signals.push({ label: `Above market price for locality (${pctDiff}% over median)`, delta });
    } else {
      signals.push({ label: 'Priced at market rate for locality', delta: 0 });
    }
  }

  const furnishing = (listing?.furnishing || '').toLowerCase();
  if (furnishing.includes('fully') || furnishing === 'furnished') {
    signals.push({ label: 'Fully furnished — move-in ready', delta: +8 });
  } else if (furnishing.includes('semi')) {
    signals.push({ label: 'Semi-furnished — moderate fit-out needed', delta: +4 });
  } else if (furnishing === 'unfurnished') {
    signals.push({ label: 'Unfurnished — furniture cost required', delta: -3 });
  }

  const sqft = Number(listing?.area_sqft);
  if (sqft && rent) {
    const pricePerSqft = rent / sqft;
    if (pricePerSqft < 30) {
      signals.push({ label: 'Good price-per-sqft ratio for locality', delta: +6 });
    } else if (pricePerSqft > 60) {
      signals.push({ label: 'High price per sqft vs locality average', delta: -4 });
    }
  }

  if (listing?.no_brokerage) {
    signals.push({ label: 'Zero brokerage — direct owner listing', delta: +5 });
  }

  return signals.slice(0, 4);
}


// SVG circular score ring
function ScoreRing({ score, size = 100 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ * (score / 100);
  const cx = size / 2;

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-border)" strokeWidth={4} />
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

// ── Image Gallery ─────────────────────────────────────────────────────────────
function TypeBadge({ imageType }) {
  if (imageType === 'society_exterior') {
    return (
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#1a0a00',
        background: '#E8A020', borderRadius: 3, padding: '2px 6px',
      }}>
        Society
      </span>
    );
  }
  if (imageType === 'locality_hero') {
    return (
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#999',
        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 3, padding: '2px 6px',
      }}>
        Area
      </span>
    );
  }
  return null;
}

function ImageGallery({ images, locality, heroHeight }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const imgs = (images && images.length > 0) ? images.slice(0, 10) : [];
  const active = imgs[activeIdx] || null;

  if (!active) {
    return (
      <div style={{
        height: heroHeight,
        background: '#111',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(232,160,32,0.06) 0%, transparent 70%)',
        }} />
        <div style={{ textAlign: 'center', position: 'relative' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🏙</p>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: '#666',
          }}>
            {locality || 'Photos coming soon'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Hero image */}
      <div style={{
        position: 'relative', height: heroHeight, overflow: 'hidden',
        background: '#0A0A0A',
      }}>
        <img
          src={active.url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {/* Type badge — bottom-left */}
        {active.image_type && active.image_type !== 'listing_interior' && (
          <div style={{ position: 'absolute', bottom: 10, left: 10 }}>
            <TypeBadge imageType={active.image_type} />
          </div>
        )}
        {/* Attribution — bottom-right, only for Google images */}
        {active.attribution === 'Google' && (
          <span style={{
            position: 'absolute', bottom: 8, right: 10,
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em',
          }}>
            📷 Google
          </span>
        )}
        {/* Image counter */}
        {imgs.length > 1 && (
          <span style={{
            position: 'absolute', top: 10, right: 10,
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.7)',
            background: 'rgba(0,0,0,0.5)', borderRadius: 3, padding: '3px 7px',
          }}>
            {activeIdx + 1}/{imgs.length}
          </span>
        )}
      </div>

      {/* Thumbnail strip */}
      {imgs.length > 1 && (
        <div style={{
          display: 'flex', gap: 3, overflowX: 'auto', scrollbarWidth: 'none',
          background: '#0A0A0A', padding: '3px 3px 0',
        }}>
          {imgs.map((img, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              style={{
                flexShrink: 0, width: 64, height: 46,
                padding: 0, border: 'none', cursor: 'pointer',
                position: 'relative', overflow: 'hidden',
                outline: i === activeIdx ? '2px solid #E8A020' : '2px solid transparent',
                outlineOffset: -2,
                borderRadius: 2,
                opacity: i === activeIdx ? 1 : 0.55,
                transition: 'opacity 0.15s, outline-color 0.15s',
              }}
              aria-label={`Image ${i + 1}`}
            >
              <img
                src={img.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
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
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useDesktop();

  // If navigated from a search card, the raw listing is passed as state — use it immediately
  // for instant render, but always fetch the full detail from the API so fields like
  // image_list / society_name that aren't in search results are available.
  const seedListing = location.state?.listing ?? null;

  const [listing,        setListing]        = useState(seedListing);
  const [loading,        setLoading]        = useState(!seedListing);
  const [notFound,       setNotFound]       = useState(false);
  const [localityStats,  setLocalityStats]  = useState(null);

  const [saved,          setSaved]          = useState(false);
  const [descExpanded,   setDescExpanded]   = useState(false);
  const [copiedScript,   setCopiedScript]   = useState(false);

  // Always fetch the full listing from the API.
  // When seedListing is present we skip the loading spinner but still hydrate
  // image_list and other detail-only fields once the response arrives.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      if (!seedListing) { setLoading(true); setNotFound(false); }
      try {
        const res = await fetch(`${API_BASE}/api/listing/${id}`);
        if (!res.ok) {
          if (!seedListing) { setNotFound(true); setLoading(false); }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setListing(data);
      } catch {
        if (!cancelled && !seedListing) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch locality stats from Supabase once we have the locality
  useEffect(() => {
    if (!listing?.locality) return;
    let cancelled = false;
    async function loadLocality() {
      try {
        const { data: rows } = await supabase
          .from('locality_stats_cache')
          .select('bhk, median_rent, listing_count')
          .ilike('locality', listing.locality)
          .order('listing_count', { ascending: false });

        if (cancelled || !rows?.length) return;

        // Pick 2BHK row or best available
        const row2 = rows.find(r => (r.bhk || '').includes('2')) || rows[0];
        const totalListings = rows.reduce((sum, r) => sum + (r.listing_count || 0), 0);

        // Deposit benchmark
        const { data: dep } = await supabase
          .from('deposit_stats_cache')
          .select('bhk, avg_multiplier, median_deposit')
          .order('bhk');

        const dep2 = dep?.find(r => (r.bhk || '').includes('2')) || dep?.[0];
        const depositMultiplier = dep2?.avg_multiplier
          ? `${Number(dep2.avg_multiplier).toFixed(1)}×`
          : '—';

        if (!cancelled) {
          setLocalityStats({
            avgRent: row2?.median_rent ? formatRentShort(row2.median_rent) : '—',
            totalListings: totalListings || '—',
            depositMultiplier,
            medianRent: row2?.median_rent || 0,
          });
        }
      } catch { /* non-fatal */ }
    }
    loadLocality();
    return () => { cancelled = true; };
  }, [listing?.locality]);


  const signals = useMemo(
    () => deriveSignals(listing, localityStats?.medianRent),
    [listing, localityStats]
  );

  const marketFit = useMemo(() => {
    const score = listing?.quality_score || 0;
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    return 'Low';
  }, [listing?.quality_score]);

  const description = cleanMarkdown(listing?.body || listing?.selftext || '');
  const descPreview = description.slice(0, 220);
  const descIsTruncated = description.length > 220;

  const depositMonths = useMemo(() => {
    const rent = Number(listing?.price || listing?.rent);
    const dep = Number(listing?.deposit);
    if (!rent || !dep) return null;
    return Math.round(dep / rent);
  }, [listing]);

  const localitySlug = listing?.locality ? localityToSlug(listing.locality) : '';
  const sourceLabel  = normalizeSource(listing?.source);
  const SOURCE_BRAND = {
    reddit:   '#F97316',
    nobroker: '#E63946',
    housing:  '#7C3AED',
    'housing.com': '#7C3AED',
    telegram: '#38BDF8',
  };
  const brandColor = SOURCE_BRAND[(listing?.source || '').toLowerCase()] || 'var(--color-amber)';

  function handleCopyScript() {
    const script = `Hi, I saw your listing for "${listing?.title}" on NestIQ. I'm interested in viewing the property. Could you please share more details? Thank you.`;
    navigator.clipboard.writeText(script).catch(() => {});
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  }

  // ── Loading / not-found states ────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0 }}>
        <DesktopSidebar />
        <AppHeader backTo />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
          <span style={{ ...s.monoSmall, fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Loading…
          </span>
        </div>
        {!isDesktop && <BottomNav />}
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0 }}>
        <DesktopSidebar />
        <AppHeader backTo />
        <div style={{ padding: '40px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>🏚</p>
          <p style={{ ...s.monoSmall, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Listing not found
          </p>
          <p style={{ ...s.monoSmall, marginBottom: 24 }}>This listing may have expired or been removed.</p>
          <button
            onClick={() => navigate(-1)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
              background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 8, padding: '10px 20px', cursor: 'pointer',
              color: 'var(--color-text-muted)', transition: 'all 0.2s',
            }}
          >
            ← Go back
          </button>
        </div>
        {!isDesktop && <BottomNav />}
      </div>
    );
  }

  const rent = Number(listing.price || listing.rent);
  const priceStr    = formatPrice(rent) || 'Price on request';
  const depositStr  = listing.deposit ? formatPrice(listing.deposit) : null;
  const sqftStr     = listing.area_sqft ? Number(listing.area_sqft).toLocaleString('en-IN') : null;
  const postedAgo   = timeAgo(listing.created || listing.created_utc);

  return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, paddingBottom: isDesktop ? 0 : 88 }}>
      <DesktopSidebar />

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
          textTransform: 'uppercase', color: brandColor,
          background: brandColor + '1a',
          border: `1px solid ${brandColor}40`,
          borderRadius: 4, padding: '3px 8px',
        }}>
          ✓ {sourceLabel}
        </span>
        {postedAgo && (
          <span style={{ ...s.monoSmall, fontSize: 10 }}>{postedAgo}</span>
        )}
      </div>

      {/* ── DESKTOP TWO-COLUMN / MOBILE SINGLE COLUMN ── */}
      <div style={isDesktop ? {
        display: 'flex', alignItems: 'flex-start', gap: 0,
        maxWidth: 1440, margin: '0 auto',
      } : {}}>

      {/* ── LEFT COLUMN (image + content) ── */}
      <div style={isDesktop ? { flex: 1, minWidth: 0 } : {}}>

      {/* ── IMAGE GALLERY ── */}
      <ImageGallery
        images={listing.image_list}
        locality={listing.locality}
        heroHeight={isDesktop ? 320 : 240}
      />

      <div style={{ padding: isDesktop ? '20px 24px 0' : '20px 16px 0' }}>

        {/* ── TITLE + STAGE + PRICE ── */}
        <section style={{ marginBottom: 24 }}>
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
              {priceStr}
            </span>
            {rent > 0 && <span style={{ ...s.monoSmall }}>/mo</span>}
          </div>
          {depositStr && (
            <p style={{ ...s.monoSmall, fontSize: 12 }}>
              Est. Deposit: <span style={{ color: 'var(--color-text-primary)' }}>{depositStr}</span>
              {depositMonths ? ` (${depositMonths} months)` : ''}
            </p>
          )}

          <div style={s.divider} />

          {/* Spec chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              listing.bhk && { icon: '🛏', label: listing.bhk },
              sqftStr     && { icon: '⊡', label: `${sqftStr} sqft` },
              listing.furnishing && { icon: '🪑', label: listing.furnishing },
              listing.locality   && { icon: '📍', label: listing.locality },
            ].filter(Boolean).map(spec => (
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: signals.length > 0 ? 20 : 0 }}>
            <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
              <ScoreRing score={listing.quality_score || 0} size={100} />
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 500,
                  color: scoreColor(listing.quality_score || 0), letterSpacing: '-0.03em', lineHeight: 1,
                }}>
                  {listing.quality_score || 0}
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
                {marketFit}
              </p>
            </div>
          </div>

          {signals.length > 0 && (
            <div>
              <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Intelligence Signals
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {signals.map((sig, i) => (
                  <div key={i} style={{
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
                      {sig.delta > 0 ? '+' : sig.delta < 0 ? '' : '±'}{String(Math.abs(sig.delta)).padStart(2, '0')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── DESCRIPTION ── */}
        {description && (
          <section style={{ ...s.card, marginBottom: 16 }}>
            <p style={s.sectionLabel}>Description</p>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.75 }}>
              {descExpanded || !descIsTruncated ? description : `${descPreview}…`}
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
        )}

        {/* On desktop: contact + locality intel move to right panel */}
        {!isDesktop && (
        <>

        {/* ── OWNER CONTACT ── */}
        <section style={{ ...s.card, marginBottom: 16 }}>
          <p style={s.sectionLabel}>Contact</p>

          {listing.contact_phone ? (
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 16,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500,
                letterSpacing: '0.04em', color: 'var(--color-text-primary)',
              }}>
                {listing.contact_phone}
              </span>
              <a
                href={`tel:${listing.contact_phone}`}
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
          ) : (
            <p style={{ ...s.monoSmall, fontSize: 13, marginBottom: 16 }}>
              Contact via source listing
            </p>
          )}

          <div style={s.divider} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            {listing.url && (
              <a
                href={listing.url}
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
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-text-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
              >
                Open on {sourceLabel} ↗
              </a>
            )}

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

            {listing.source === 'telegram' && listing.contact_phone && (
              <a
                href={`https://wa.me/${listing.contact_phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  background: 'none', border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 8, padding: '10px 14px',
                  color: '#22C55E', textDecoration: 'none',
                  transition: 'border-color 0.2s',
                }}
              >
                <i className="fa-brands fa-whatsapp" style={{ fontSize: 13 }} /> WhatsApp
              </a>
            )}
          </div>
        </section>

        {/* ── LOCALITY INTEL ── */}
        <section style={{ marginBottom: 16 }}>
          <p style={{ ...s.sectionLabel, marginBottom: 10 }}>
            Locality Intel: {listing.locality || '—'}
          </p>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8, marginBottom: 14,
          }}>
            {[
              { label: 'Avg Rent',        value: localityStats?.avgRent        || '—' },
              { label: 'Active Listings', value: localityStats?.totalListings   || '—' },
              { label: 'Avg Deposit',     value: localityStats?.depositMultiplier || '—' },
              { label: 'Price Trend',     value: '—' },
            ].map(stat => (
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

          {localitySlug && (
            <Link
              to={`/neighbourhood-pulse/${localitySlug}`}
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
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
            >
              View Full Intelligence Report
              <span style={{ fontSize: 14 }}>→</span>
            </Link>
          )}
        </section>

        </>
        )}{/* end !isDesktop */}

      </div>{/* end padding div */}

      </div>{/* end left column */}

      {/* ── RIGHT COLUMN (desktop sticky panel) ── */}
      {isDesktop && (
        <div style={{
          width: 320, flexShrink: 0,
          position: 'sticky', top: 56,
          alignSelf: 'flex-start',
          padding: '20px 20px 20px 0',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 56px)',
          scrollbarWidth: 'none',
        }}>

          {/* Price + save + open */}
          <div style={{
            ...s.card,
            marginBottom: 12,
            border: '1px solid var(--color-border)',
          }}>
            <div style={{ marginBottom: 14 }}>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 500,
                color: 'var(--color-text-primary)', letterSpacing: '-0.03em', lineHeight: 1,
                marginBottom: 4,
              }}>
                {priceStr}
              </p>
              {depositStr && (
                <p style={{ ...s.monoSmall, fontSize: 11, marginTop: 4 }}>
                  Deposit: <span style={{ color: 'var(--color-text-primary)' }}>{depositStr}</span>
                  {depositMonths ? ` (${depositMonths} mo)` : ''}
                </p>
              )}
              <p style={{ ...s.monoSmall, fontSize: 10, marginTop: 2 }}>
                {[listing.bhk, listing.locality].filter(Boolean).join(' · ')}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setSaved(v => !v)}
                style={{
                  background: 'none',
                  border: `1px solid ${saved ? '#E8394D' : 'var(--color-border)'}`,
                  color: saved ? '#E8394D' : 'var(--color-text-muted)',
                  borderRadius: 8, width: 42, height: 42, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s', flexShrink: 0, fontSize: 16,
                }}
                aria-label={saved ? 'Unsave' : 'Save'}
              >
                <i className={saved ? 'fa-solid fa-heart' : 'fa-regular fa-heart'} />
              </button>

              {listing.url ? (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, textAlign: 'center',
                    fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
                    background: 'var(--color-amber)', color: '#1a0a00',
                    border: 'none', borderRadius: 8, padding: '10px 16px',
                    textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 20px -4px rgba(232,160,32,0.3)', transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  Open on {sourceLabel} →
                </a>
              ) : listing.contact_phone ? (
                <a
                  href={`tel:${listing.contact_phone}`}
                  style={{
                    flex: 1, textAlign: 'center',
                    fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
                    background: 'var(--color-amber)', color: '#1a0a00',
                    border: 'none', borderRadius: 8, padding: '10px 16px',
                    textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'opacity 0.2s',
                  }}
                >
                  📞 Call
                </a>
              ) : null}
            </div>
          </div>

          {/* Contact */}
          <div style={{ ...s.card, marginBottom: 12, border: '1px solid var(--color-border)' }}>
            <p style={s.sectionLabel}>Contact</p>
            {listing.contact_phone && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                  {listing.contact_phone}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={`tel:${listing.contact_phone}`} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                    textTransform: 'uppercase', background: 'none',
                    border: '1px solid var(--color-border)', borderRadius: 8,
                    padding: '8px 12px', color: 'var(--color-text-muted)', textDecoration: 'none',
                    transition: 'border-color 0.2s',
                  }}>📞 Call</a>
                  {(listing.source === 'telegram' || listing.source === 'Telegram') && listing.contact_phone && (
                    <a href={`https://wa.me/${listing.contact_phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                      textTransform: 'uppercase', background: 'none',
                      border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8,
                      padding: '8px 12px', color: '#22C55E', textDecoration: 'none',
                    }}>
                      <i className="fa-brands fa-whatsapp" style={{ fontSize: 13 }} /> WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )}
            {listing.url && (
              <button
                onClick={handleCopyScript}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: 'none', border: '1px solid var(--color-border)', borderRadius: 8,
                  padding: '10px 14px', color: copiedScript ? '#22C55E' : 'var(--color-text-muted)',
                  cursor: 'pointer', transition: 'border-color 0.2s, color 0.2s',
                }}
              >
                {copiedScript ? '✓ Copied' : '⎘ Copy Outreach Script'}
              </button>
            )}
          </div>

          {/* Locality intel */}
          {listing.locality && (
            <div style={{ ...s.card, border: '1px solid var(--color-border)' }}>
              <p style={s.sectionLabel}>Locality Intel</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
                {[
                  { label: 'Avg Rent',        value: localityStats?.avgRent || '—' },
                  { label: 'Active Listings', value: localityStats?.totalListings || '—' },
                  { label: 'Avg Deposit',     value: localityStats?.depositMultiplier || '—' },
                  { label: 'Price Trend',     value: '—' },
                ].map(stat => (
                  <div key={stat.label} style={{ background: 'var(--color-bg-card)', borderRadius: 8, padding: '10px 12px' }}>
                    <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{stat.label}</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)' }}>{stat.value}</p>
                  </div>
                ))}
              </div>
              {localitySlug && (
                <Link
                  to={`/neighbourhood-pulse/${localitySlug}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                    textTransform: 'uppercase', textDecoration: 'none',
                    color: 'var(--color-text-muted)', background: 'var(--color-bg-card)',
                    borderRadius: 8, padding: '10px 14px',
                    border: '1px solid var(--color-border)', transition: 'border-color 0.2s, color 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                >
                  Full Intelligence Report <span>→</span>
                </Link>
              )}
            </div>
          )}

        </div>
      )}{/* end right column */}

      </div>{/* end two-column wrapper */}

      {/* ── STICKY BOTTOM CTA (mobile only) ── */}
      {!isDesktop && <div style={{
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
            {priceStr}
          </p>
          <p style={{ ...s.monoSmall, fontSize: 10, marginTop: 2 }}>
            {[listing.bhk, listing.locality].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* Save toggle */}
        <button
          onClick={() => setSaved(v => !v)}
          style={{
            background: 'none',
            border: `1px solid ${saved ? '#E8394D' : 'var(--color-border)'}`,
            color: saved ? '#E8394D' : 'var(--color-text-muted)',
            borderRadius: 8, width: 42, height: 42, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', flexShrink: 0, fontSize: 16,
          }}
          aria-label={saved ? 'Unsave' : 'Save'}
        >
          <i className={saved ? 'fa-solid fa-heart' : 'fa-regular fa-heart'} />
        </button>

        {/* Primary CTA */}
        {listing.url ? (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
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
            Open on {sourceLabel} →
          </a>
        ) : listing.contact_phone ? (
          <a
            href={`tel:${listing.contact_phone}`}
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
            📞 Call
          </a>
        ) : null}
      </div>}{/* end sticky bottom CTA */}

    </div>
  );
}
