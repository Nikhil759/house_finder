import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faLaptopCode, faBuilding, faTree, faBeerMugEmpty,
  faHammer, faWater, faHouse, faBolt,
} from '@fortawesome/free-solid-svg-icons';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { useSavedListings } from '../hooks/useSavedListings';
import { useSearchLogs } from '../hooks/useSearchLogs';
import { useDesktop } from '../hooks/useDesktop';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── Locality autocomplete list (mirrors App.jsx) ──────────────────────────────
const BANGALORE_AREAS = [
  'Indiranagar', 'Whitefield', 'Koramangala', 'HSR Layout', 'HSR',
  'Bellandur', 'Marathahalli', 'Sarjapur Road', 'Sarjapur', 'BTM Layout', 'BTM',
  'Jayanagar', 'Hebbal', 'Yelahanka', 'Electronic City', 'Bannerghatta',
  'Cunningham Road', 'MG Road', 'Frazer Town', 'Banaswadi', 'Hoodi',
  'KR Puram', 'Domlur', 'Madiwala', 'Bommanahalli', 'Brookefield',
  'Kadubeesanahalli', 'Panathur', 'Varthur', 'Thubarahalli', 'Kadugodi',
  'JP Nagar', 'Banashankari', 'Rajajinagar', 'Malleshwaram', 'Yeshwanthpur',
  'Nagawara', 'HBR Layout', 'CV Raman Nagar', 'Old Airport Road',
  'ITPL', 'Manyata', 'Thanisandra', 'Hennur', 'Kalyan Nagar', 'RT Nagar',
  'Ejipura', 'Ulsoor', 'Basavanagudi', 'Sadashivanagar', 'Vijayanagar', 'Kengeri',
];

// ── Source config ─────────────────────────────────────────────────────────────
const SOURCE_CONFIG = {
  reddit:   { label: 'Reddit',      color: '#F97316', icon: 'fa-brands fa-reddit-alien' },
  nobroker: { label: 'NoBroker',    color: '#E63946', icon: 'fa-solid fa-house' },
  housing:  { label: 'Housing.com', color: '#7C3AED', icon: 'fa-solid fa-building' },
  telegram: { label: 'Telegram',    color: '#38BDF8', icon: 'fa-brands fa-telegram' },
};

const SOURCE_LABELS = Object.fromEntries(
  Object.entries(SOURCE_CONFIG).map(([k, v]) => [k, v.label])
);

const SORT_OPTIONS      = ['Score', 'Newest'];
const BHK_OPTIONS       = ['Studio', '1', '2', '3', '4+'];
const FURNISHED_OPTIONS = ['Any', 'Furnished', 'Unfurnished'];

const LOCALITY_CHIPS = [
  { label: 'Koramangala',    icon: faBeerMugEmpty },
  { label: 'HSR Layout',     icon: faLaptopCode   },
  { label: 'Whitefield',     icon: faBuilding     },
  { label: 'Indiranagar',    icon: faTree         },
  { label: 'Hoodi',          icon: faHammer       },
  { label: 'Bellandur',      icon: faWater        },
  { label: 'BTM Layout',     icon: faHouse        },
  { label: 'Electronic City',icon: faBolt         },
];

const QUICK_FILTERS = [
  { key: '1bhk',       label: '1 BHK',              category: 'bhk'       },
  { key: '2bhk',       label: '2 BHK',              category: 'bhk'       },
  { key: '3bhk',       label: '3 BHK',              category: 'bhk'       },
  { key: 'furnished',  label: 'Furnished',           category: 'furnished' },
  { key: 'semi',       label: 'Semi-furnished',      category: 'furnished' },
  { key: 'u20k',       label: '< ₹20k',             category: 'price'     },
  { key: 'u35k',       label: '< ₹35k',             category: 'price'     },
  { key: 'u50k',       label: '< ₹50k',             category: 'price'     },
  { key: 'community',  label: 'Community listings',  category: 'source'    },
  { key: 'high_score', label: 'High score 70+',      category: 'quality'   },
];

const DEFAULT_FILTERS = {
  bhk:       [],
  minBudget: '',
  maxBudget: '',
  furnished: 'Any',
  keywords:  '',
  sources:   { reddit: true, nobroker: true, housing: true, telegram: true },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(epoch) {
  if (!epoch) return '';
  const diff = Date.now() / 1000 - epoch;
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

function formatPrice(rent) {
  const n = Number(rent);
  if (!rent || isNaN(n) || n === 0) return null;
  return `₹${n.toLocaleString('en-IN')}`;
}

function scoreColor(score) {
  if (score >= 70) return '#E8A020';             // full amber
  if (score >= 50) return 'rgba(232,160,32,0.5)'; // dim amber
  return '#555555';                               // muted gray
}

const KNOWN_SOURCES = new Set(['reddit', 'nobroker', 'telegram', 'housing']);

// Always returns a stable compound ID: "{source}_{source_id}"
// Handles: DB listings (already compound), live NoBroker cache (nb_xxx), live Reddit (bare id)
function stableListingId(p) {
  const raw = (p.id || '').toString();
  const src = (p.source || '').toLowerCase();
  const prefix = raw.split('_')[0];
  if (KNOWN_SOURCES.has(prefix)) return raw;              // already compound from DB
  if (raw.startsWith('nb_')) return `nobroker_${raw.slice(3)}`; // NoBroker live cache
  if (src) return `${src}_${raw}`;                         // live Reddit / Telegram
  return raw;
}

function normalizePost(p) {
  const cfg = SOURCE_CONFIG[p.source] || { label: p.source, color: '#666', icon: 'fa-solid fa-circle' };
  return {
    id:          stableListingId(p),
    source:      cfg.label,
    sourceColor: cfg.color,
    sourceIcon:  cfg.icon,
    rawSource:   p.source,
    timeAgo:     timeAgo(p.created || p.created_utc),
    score:       Math.round(p.quality_score || 0),
    title:       p.title || '(no title)',
    bhk:         p.bhk || null,
    sqft:        p.area_sqft ? Number(p.area_sqft).toLocaleString('en-IN') : null,
    furnished:   p.furnishing || null,
    price:       formatPrice(p.price ?? p.rent),
    rawRent:     p.price ?? p.rent ?? null,
    isBroker:    p.is_broker ?? null,
    noBrokerage: p.no_brokerage ?? false,
    location:    p.locality || null,
    latitude:    p.latitude  ?? null,
    longitude:   p.longitude ?? null,
    url:         p.url || p.source_url || null,
    rawCreated:  p.created || p.created_utc || 0,
    _raw:        p,
  };
}

// ── Shared sub-components ─────────────────────────────────────────────────────
function SourceBadge({ source, color, icon }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      background: 'var(--color-bg-card)',
      color: color || 'var(--color-text-muted)',
      border: `1px solid ${color ? color + '33' : 'var(--color-border)'}`,
      borderRadius: 4,
      padding: '3px 8px',
    }}>
      {icon && <i className={icon} style={{ fontSize: 9 }} />}
      {source}
    </span>
  );
}

function FilterPill({ label, onRemove, onOpenSheet }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '0.05em',
      background: 'var(--color-bg-surface)',
      color: 'var(--color-text-primary)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-pill)',
      padding: '5px 12px',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }}>
      <span onClick={onOpenSheet}>{label}</span>
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          padding: 0,
          lineHeight: 1,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
        }}
        aria-label={`Remove ${label} filter`}
      >
        ×
      </button>
    </span>
  );
}

// ── Filter bottom sheet ───────────────────────────────────────────────────────
function SheetSection({ label, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
        marginBottom: 12,
      }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function PillToggle({ label, active, onClick, activeColor }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        letterSpacing: '0.05em',
        background: active ? (activeColor || 'var(--color-amber)') : 'var(--color-bg-card)',
        color: active ? (activeColor ? '#fff' : '#1a0a00') : 'var(--color-text-muted)',
        border: active ? `1px solid ${activeColor || 'var(--color-amber)'}` : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-pill)',
        padding: '7px 16px',
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function BudgetInput({ placeholder, value, onChange }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        flex: 1,
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '10px 12px',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        outline: 'none',
        minWidth: 0,
        WebkitAppearance: 'none',
        MozAppearance: 'textfield',
      }}
    />
  );
}

function FilterBottomSheet({ open, onClose, initialFilters, initialSort, onApply }) {
  const [draft, setDraft]       = useState(() => ({
    ...DEFAULT_FILTERS,
    sources: { ...DEFAULT_FILTERS.sources },
  }));
  const [draftSort, setDraftSort] = useState('Score');

  // Sync draft state whenever the sheet opens
  useEffect(() => {
    if (open) {
      setDraft({ ...initialFilters, sources: { ...initialFilters.sources } });
      setDraftSort(initialSort);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleBhk(val) {
    setDraft(d => ({
      ...d,
      bhk: d.bhk.includes(val) ? d.bhk.filter(b => b !== val) : [...d.bhk, val],
    }));
  }

  function toggleSource(key) {
    setDraft(d => ({
      ...d,
      sources: { ...d.sources, [key]: !d.sources[key] },
    }));
  }

  function handleReset() {
    setDraft({ ...DEFAULT_FILTERS, sources: { ...DEFAULT_FILTERS.sources } });
    setDraftSort('Score');
  }

  function handleApply() {
    onApply({ filters: draft, sort: draftSort });
    onClose();
  }

  if (!open) return null;

  const sliderMax = draft.maxBudget ? Number(draft.maxBudget) : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 101,
        height: '75vh',
        background: '#111111',
        borderRadius: '16px 16px 0 0',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideUp 0.25s ease-out',
      }}>
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14, paddingBottom: 6 }}>
          <div style={{ width: 40, height: 4, background: '#333', borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 20px 14px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 400, letterSpacing: '-0.01em' }}>
            Filters
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 16,
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 0', scrollbarWidth: 'none' }}>

          {/* BHK */}
          <SheetSection label="BHK">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {BHK_OPTIONS.map(opt => (
                <PillToggle
                  key={opt}
                  label={opt}
                  active={draft.bhk.includes(opt)}
                  onClick={() => toggleBhk(opt)}
                />
              ))}
            </div>
          </SheetSection>

          {/* Budget */}
          <SheetSection label="Budget">
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <BudgetInput
                placeholder="Min ₹"
                value={draft.minBudget}
                onChange={v => setDraft(d => ({ ...d, minBudget: v }))}
              />
              <BudgetInput
                placeholder="Max ₹"
                value={draft.maxBudget}
                onChange={v => setDraft(d => ({ ...d, maxBudget: v }))}
              />
            </div>
            <input
              type="range"
              min={0}
              max={150000}
              step={5000}
              value={sliderMax}
              onChange={e => setDraft(d => ({ ...d, maxBudget: e.target.value === '0' ? '' : e.target.value }))}
              className="filter-range-slider"
            />
            {sliderMax > 0 && (
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-amber)',
                letterSpacing: '0.04em',
                marginTop: 8,
                textAlign: 'right',
              }}>
                up to ₹{Number(sliderMax).toLocaleString('en-IN')}
              </p>
            )}
          </SheetSection>

          {/* Furnished */}
          <SheetSection label="Furnished">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {FURNISHED_OPTIONS.map(opt => (
                <PillToggle
                  key={opt}
                  label={opt}
                  active={draft.furnished === opt}
                  onClick={() => setDraft(d => ({ ...d, furnished: opt }))}
                />
              ))}
            </div>
          </SheetSection>

          {/* Keywords */}
          <SheetSection label="Keywords">
            <input
              type="text"
              value={draft.keywords}
              onChange={e => setDraft(d => ({ ...d, keywords: e.target.value }))}
              placeholder="parking, pet-friendly, no brokerage…"
              style={{
                width: '100%',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '10px 12px',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </SheetSection>

          {/* Sort by */}
          <SheetSection label="Sort By">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SORT_OPTIONS.map(opt => (
                <PillToggle
                  key={opt}
                  label={opt}
                  active={draftSort === opt}
                  onClick={() => setDraftSort(opt)}
                />
              ))}
            </div>
          </SheetSection>

          {/* Sources */}
          <SheetSection label="Sources">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(SOURCE_CONFIG).map(([key, cfg]) => (
                <PillToggle
                  key={key}
                  label={cfg.label}
                  active={draft.sources[key]}
                  onClick={() => toggleSource(key)}
                  activeColor={cfg.color}
                />
              ))}
            </div>
          </SheetSection>

          <div style={{ height: 24 }} />
        </div>

        {/* Bottom action buttons */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          gap: 12,
          background: '#111111',
        }}>
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.04em',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '13px',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
            }}
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            style={{
              flex: 2,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.04em',
              background: 'var(--color-amber)',
              border: 'none',
              borderRadius: 8,
              padding: '13px',
              cursor: 'pointer',
              color: '#1a0a00',
              fontWeight: 500,
            }}
          >
            Apply Filters →
          </button>
        </div>
      </div>
    </>
  );
}

// ── Nearby areas collapsible ──────────────────────────────────────────────────
function PaginationBar({ page, pageCount, onPageChange }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 20,
      marginBottom: 8,
    }}>
      <button
        onClick={() => { onPageChange(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        disabled={page === 1}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: '0.04em',
          background: 'none',
          border: '1px solid var(--color-border)',
          color: page === 1 ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          borderRadius: 8,
          padding: '7px 14px',
          cursor: page === 1 ? 'not-allowed' : 'pointer',
          opacity: page === 1 ? 0.35 : 1,
          transition: 'border-color 0.15s',
        }}
      >
        ← Prev
      </button>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.06em',
        color: 'var(--color-text-muted)',
        minWidth: 60,
        textAlign: 'center',
      }}>
        {page} / {pageCount}
      </span>
      <button
        onClick={() => { onPageChange(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        disabled={page === pageCount}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: '0.04em',
          background: page === pageCount ? 'none' : 'var(--color-amber)',
          border: page === pageCount ? '1px solid var(--color-border)' : 'none',
          color: page === pageCount ? 'var(--color-text-muted)' : '#1a0a00',
          borderRadius: 8,
          padding: '7px 14px',
          cursor: page === pageCount ? 'not-allowed' : 'pointer',
          opacity: page === pageCount ? 0.35 : 1,
          fontWeight: page === pageCount ? 400 : 500,
          transition: 'background 0.15s',
        }}
      >
        Next →
      </button>
    </div>
  );
}

function NearbyDropdown({ localities }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.05em',
          color: 'var(--color-text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{
          display: 'inline-block',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
        also showing nearby areas
      </button>
      {open && (
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
          marginTop: 4,
        }}>
          {localities.join(' · ')}
        </p>
      )}
    </div>
  );
}

// ── Card components ───────────────────────────────────────────────────────────
function ListingCard({ listing, saved, onToggleSave }) {
  const [popped, setPopped] = useState(false);

  function handleSaveClick(e) {
    e.preventDefault();
    e.stopPropagation();
    onToggleSave();
    if (!saved) {
      setPopped(true);
      setTimeout(() => setPopped(false), 350);
    }
  }

  return (
    <Link
      to={`/listing/${listing.id}`}
      state={{ listing: listing._raw }}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <article style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-card)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-surface)'; }}
      >
        {/* Header row: source + time + score */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SourceBadge source={listing.source} color={listing.sourceColor} icon={listing.sourceIcon} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.03em',
            }}>
              {listing.timeAgo}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}>
              Score
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 22,
              fontWeight: 500,
              color: scoreColor(listing.score),
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}>
              {listing.score}
            </span>
          </div>
        </div>

        {/* Title */}
        <h3 style={{
          fontWeight: 300,
          fontSize: 16,
          lineHeight: 1.4,
          letterSpacing: '-0.01em',
          marginBottom: 12,
        }}>
          {listing.title}
        </h3>

        {/* Spec row */}
        <div style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 10,
          alignItems: 'center',
        }}>
          {[listing.bhk, listing.sqft && `${listing.sqft} sqft`, listing.furnished]
            .filter(Boolean)
            .map(spec => (
              <span key={spec} style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.05em',
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-card)',
                borderRadius: 4,
                padding: '3px 8px',
              }}>
                {spec}
              </span>
            ))}
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: listing.price ? 500 : 400,
            color: listing.price ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            marginLeft: 'auto',
            letterSpacing: '-0.01em',
            fontStyle: listing.price ? 'normal' : 'italic',
          }}>
            {listing.price || 'Price on request'}
          </span>
        </div>

        {/* Location */}
        {listing.location && (
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.04em',
            marginBottom: 14,
          }}>
            <i className="fa-solid fa-location-dot" style={{ marginRight: 5, color: 'var(--color-text-muted)' }} />
            {listing.location}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleSaveClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              background: 'none',
              border: `1px solid ${saved ? '#E8394D' : 'var(--color-border)'}`,
              color: saved ? '#E8394D' : 'var(--color-text-muted)',
              borderRadius: 6,
              padding: '7px 14px',
              height: 32,
              cursor: 'pointer',
              transition: 'border-color 0.2s, color 0.2s',
            }}
          >
            <i
              className={saved ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}
              style={{ animation: popped ? 'heartPop 0.35s ease' : 'none' }}
            />
            {saved ? 'Saved' : 'Save'}
          </button>
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.06em',
                background: 'none',
                color: 'var(--color-amber)',
                border: '1px solid rgba(232,160,32,0.3)',
                background: 'rgba(232,160,32,0.05)',
                borderRadius: 6,
                padding: '0 14px',
                height: 34,
                textDecoration: 'none',
                transition: 'border-color 0.2s, color 0.2s, background 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber)'; e.currentTarget.style.background = 'rgba(232,160,32,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(232,160,32,0.3)'; e.currentTarget.style.background = 'rgba(232,160,32,0.05)'; }}
            >
              <i className="fa-solid fa-arrow-up-right-from-square" style={{ fontSize: 12 }} />
              Source
            </a>
          )}
        </div>
      </article>
    </Link>
  );
}

function GridCard({ listing, saved, onToggleSave }) {
  const [popped, setPopped] = useState(false);

  function handleSaveClick(e) {
    e.preventDefault();
    e.stopPropagation();
    onToggleSave();
    if (!saved) {
      setPopped(true);
      setTimeout(() => setPopped(false), 350);
    }
  }

  return (
    <Link
      to={`/listing/${listing.id}`}
      state={{ listing: listing._raw }}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <article style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-card)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-surface)'; }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <SourceBadge source={listing.source} color={listing.sourceColor} icon={listing.sourceIcon} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 20,
            fontWeight: 500,
            color: scoreColor(listing.score),
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}>
            {listing.score}
          </span>
        </div>

        <h3 style={{
          fontWeight: 300,
          fontSize: 14,
          lineHeight: 1.4,
          letterSpacing: '-0.01em',
          flex: 1,
        }}>
          {listing.title}
        </h3>

        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}>
          {[listing.bhk, listing.location].filter(Boolean).join(' · ')}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: listing.price ? 15 : 11,
            fontWeight: listing.price ? 500 : 400,
            color: listing.price ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            fontStyle: listing.price ? 'normal' : 'italic',
          }}>
            {listing.price || 'Price on request'}
          </span>
          <button
            onClick={handleSaveClick}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: saved ? '#E8394D' : 'var(--color-text-muted)',
              fontSize: 16,
              padding: 0,
              transition: 'color 0.2s',
            }}
            aria-label={saved ? 'Unsave listing' : 'Save listing'}
          >
            <i
              className={saved ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}
              style={{ animation: popped ? 'heartPop 0.35s ease' : 'none' }}
            />
          </button>
        </div>
      </article>
    </Link>
  );
}

// ── Map helpers (mirrors App.jsx) ─────────────────────────────────────────────
const LOCALITY_COORDS = {
  'Indiranagar':      [12.9784, 77.6408],
  'Whitefield':       [12.9698, 77.7499],
  'Koramangala':      [12.9352, 77.6245],
  'HSR Layout':       [12.9116, 77.6389],
  'HSR':              [12.9116, 77.6389],
  'Bellandur':        [12.9257, 77.6761],
  'Marathahalli':     [12.9591, 77.6974],
  'Sarjapur Road':    [12.9087, 77.6950],
  'Sarjapur':         [12.9087, 77.6950],
  'BTM Layout':       [12.9165, 77.6101],
  'BTM':              [12.9165, 77.6101],
  'Jayanagar':        [12.9299, 77.5820],
  'Hebbal':           [13.0353, 77.5947],
  'Yelahanka':        [13.1007, 77.5963],
  'Electronic City':  [12.8399, 77.6770],
  'Bannerghatta':     [12.8634, 77.5855],
  'Cunningham Road':  [12.9812, 77.5958],
  'MG Road':          [12.9756, 77.6099],
  'Frazer Town':      [12.9854, 77.6146],
  'Banaswadi':        [13.0109, 77.6553],
  'Hoodi':            [12.9876, 77.7028],
  'KR Puram':         [13.0068, 77.6943],
  'Domlur':           [12.9609, 77.6387],
  'Madiwala':         [12.9196, 77.6182],
  'Bommanahalli':     [12.8998, 77.6396],
  'Brookefield':      [12.9690, 77.7123],
  'Kadubeesanahalli': [12.9354, 77.7004],
  'Panathur':         [12.9344, 77.7127],
  'Varthur':          [12.9352, 77.7489],
  'Thubarahalli':     [12.9572, 77.7225],
  'Kadugodi':         [12.9775, 77.7593],
  'JP Nagar':         [12.9077, 77.5851],
  'Banashankari':     [12.9259, 77.5468],
  'Rajajinagar':      [12.9899, 77.5530],
  'Malleshwaram':     [13.0035, 77.5687],
  'Yeshwanthpur':     [13.0265, 77.5449],
  'Nagawara':         [13.0435, 77.6202],
  'HBR Layout':       [13.0277, 77.6384],
  'CV Raman Nagar':   [12.9848, 77.6618],
  'Old Airport Road': [12.9592, 77.6484],
  'ITPL':             [12.9854, 77.7308],
  'Manyata':          [13.0467, 77.6210],
  'Thanisandra':      [13.0590, 77.6350],
  'Hennur':           [13.0440, 77.6480],
  'Kalyan Nagar':     [13.0254, 77.6400],
  'RT Nagar':         [13.0210, 77.5970],
  'Ejipura':          [12.9420, 77.6220],
  'Ulsoor':           [12.9810, 77.6200],
  'Basavanagudi':     [12.9420, 77.5730],
  'Sadashivanagar':   [13.0060, 77.5810],
  'Vijayanagar':      [12.9710, 77.5330],
  'Kengeri':          [12.9070, 77.4850],
};

const LOCALITY_RADIUS_DEG = {
  'Whitefield': 0.045, 'HSR Layout': 0.027, 'HSR': 0.027,
  'Koramangala': 0.027, 'Indiranagar': 0.0225, 'Marathahalli': 0.027,
  'Bellandur': 0.0225, 'BTM Layout': 0.0225, 'BTM': 0.0225,
  'Hebbal': 0.027, 'Yelahanka': 0.027, 'Electronic City': 0.036,
  'Sarjapur Road': 0.032, 'Sarjapur': 0.032, 'Hoodi': 0.018,
  'Jayanagar': 0.0225, 'Bannerghatta': 0.027, 'Cunningham Road': 0.018,
  'MG Road': 0.018, 'Frazer Town': 0.018, 'Banaswadi': 0.0225,
  'KR Puram': 0.0225, 'Domlur': 0.018, 'Madiwala': 0.018,
  'Bommanahalli': 0.0225, 'Brookefield': 0.018, 'Kadubeesanahalli': 0.018,
  'Panathur': 0.018, 'Varthur': 0.0225, 'Thubarahalli': 0.018,
  'Kadugodi': 0.018, 'JP Nagar': 0.0225, 'Banashankari': 0.0225,
  'Rajajinagar': 0.0225, 'Malleshwaram': 0.0225, 'Yeshwanthpur': 0.0225,
  'Nagawara': 0.0225, 'HBR Layout': 0.0225, 'CV Raman Nagar': 0.018,
  'Old Airport Road': 0.018, 'ITPL': 0.018, 'Manyata': 0.018,
  'Thanisandra': 0.018, 'Hennur': 0.0225, 'Kalyan Nagar': 0.018,
  'RT Nagar': 0.018, 'Ejipura': 0.0135, 'Ulsoor': 0.0135,
  'Basavanagudi': 0.018, 'Sadashivanagar': 0.018, 'Vijayanagar': 0.018,
  'Kengeri': 0.027,
};

function idHash(id) {
  const s = String(id);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 31) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const MAP_DARK_TILE  = 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png';
const MAP_LIGHT_TILE = 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png';

function SearchMapView({ listings }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const tileLayerRef  = useRef(null);
  const markersRef    = useRef([]);
  const navigate      = useNavigate();

  // Read theme from <html data-theme="..."> attribute so we don't need a context import
  const getTheme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(getTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Expose SPA navigation to popup onclick handlers (Leaflet renders outside React)
  useEffect(() => {
    window.__nestiqGoTo = (id) => navigate(`/listing/${id}`);
    return () => { delete window.__nestiqGoTo; };
  }, [navigate]);

  // Init Leaflet map once on mount
  useEffect(() => {
    const L = window.L;
    if (!L || !containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: [12.9716, 77.5946],
      zoom: 12,
      preferCanvas: true,
    });

    const tile = getTheme() === 'light' ? MAP_LIGHT_TILE : MAP_DARK_TILE;
    tileLayerRef.current = L.tileLayer(tile, {
      attribution: '© OSM contributors © CartoDB',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current      = null;
      tileLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swap tile layer when theme changes
  useEffect(() => {
    if (!tileLayerRef.current) return;
    tileLayerRef.current.setUrl(theme === 'light' ? MAP_LIGHT_TILE : MAP_DARK_TILE);
  }, [theme]);

  // Sync markers whenever listings or theme change
  useEffect(() => {
    const L   = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const isDark = theme === 'dark';
    const popupClass = isDark ? 'dark-popup' : 'light-popup';

    // Colours that match CSS variables at runtime
    const bg          = isDark ? '#13131f' : '#ffffff';
    const border      = isDark ? '#2a2a3a' : '#e5e7eb';
    const titleColor  = isDark ? '#e8e4d8' : '#111827';
    const mutedColor  = isDark ? '#6b7280' : '#9ca3af';
    const pillBg      = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
    const dividerColor = isDark ? '#1e1e2e' : '#f3f4f6';
    const btnBg       = isDark ? 'rgba(232,160,32,0.12)' : 'rgba(232,160,32,0.1)';

    listings.forEach(listing => {
      let coords;

      if (listing.latitude && listing.longitude) {
        coords = [listing.latitude, listing.longitude];
      } else {
        const loc = listing.location;
        if (!loc) return;
        const base = LOCALITY_COORDS[loc];
        if (!base) return;
        const h         = idHash(listing.id || loc);
        const angle     = (h % 1000) / 1000 * 2 * Math.PI;
        const radiusDeg = LOCALITY_RADIUS_DEG[loc] || 0.02;
        const dist      = ((h >> 8) % 1000) / 1000 * radiusDeg * 0.7;
        coords = [base[0] + dist * Math.cos(angle), base[1] + dist * Math.sin(angle)];
      }

      const scoreColor =
        listing.score >= 70 ? '#E8A020' :
        listing.score >= 50 ? 'rgba(232,160,32,0.7)' :
                              (isDark ? '#4b5563' : '#9ca3af');

      const markerColor =
        listing.score >= 70 ? '#E8A020' :
        listing.score >= 50 ? 'rgba(232,160,32,0.6)' :
                              '#555555';

      const icon = L.divIcon({
        html: `<div style="
          width:13px;height:13px;border-radius:50%;
          background:${markerColor};
          border:2px solid rgba(0,0,0,0.4);
          box-shadow:0 0 7px ${markerColor}aa;
          cursor:pointer;
        "></div>`,
        className: '',
        iconSize:    [13, 13],
        iconAnchor:  [6,  6],
        popupAnchor: [0, -12],
      });

      const title    = listing.title.length > 80 ? listing.title.slice(0, 80) + '…' : listing.title;
      const loc      = listing.location;
      const priceStr = listing.price;   // already "₹xx,xxx"
      const bhk      = listing.bhk;
      const src      = listing.source;
      const srcColor = listing.sourceColor || '#888';

      // Source + score row
      const topRow = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="
            display:inline-flex;align-items:center;gap:4px;
            font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.06em;
            background:${srcColor}18;color:${srcColor};
            padding:3px 8px;border-radius:20px;
          ">${src}</span>
          <span style="
            font-family:'DM Mono',monospace;font-size:18px;font-weight:500;
            color:${scoreColor};letter-spacing:-0.03em;line-height:1;
          ">${listing.score}</span>
        </div>
      `;

      // Title
      const titleBlock = `
        <div style="
          font-family:'DM Sans',sans-serif;font-size:13px;font-weight:300;
          color:${titleColor};line-height:1.45;letter-spacing:-0.01em;
          margin-bottom:9px;
        ">${title}</div>
      `;

      // Meta: BHK · locality
      const metaParts = [bhk, loc].filter(Boolean).join(' · ');
      const metaBlock = metaParts ? `
        <div style="
          font-family:'DM Mono',monospace;font-size:10px;
          color:${mutedColor};letter-spacing:0.04em;
          margin-bottom:9px;
        ">${metaParts}</div>
      ` : '';

      // Price + CTA row
      const priceBlock = `
        <div style="
          display:flex;justify-content:space-between;align-items:center;
          padding-top:8px;border-top:1px solid ${dividerColor};
        ">
          <span style="
            font-family:'DM Mono',monospace;
            font-size:${priceStr ? '14px' : '11px'};
            font-weight:${priceStr ? '500' : '400'};
            color:${priceStr ? titleColor : mutedColor};
            font-style:${priceStr ? 'normal' : 'italic'};
          ">${priceStr ? `${priceStr}/mo` : 'Price on request'}</span>
          <button
            onclick="window.__nestiqGoTo('${listing.id}')"
            style="
              font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.06em;
              background:${btnBg};color:#E8A020;
              border:1px solid rgba(232,160,32,0.3);border-radius:6px;
              padding:5px 11px;cursor:pointer;
              transition:background 0.15s;
            "
            onmouseover="this.style.background='rgba(232,160,32,0.2)'"
            onmouseout="this.style.background='${btnBg}'"
          >View details</button>
        </div>
      `;

      const popup = `
        <div style="width:240px;box-sizing:border-box;">
          ${topRow}${titleBlock}${metaBlock}${priceBlock}
        </div>
      `;

      const marker = L.marker(coords, { icon })
        .bindPopup(popup, { maxWidth: 290, className: popupClass })
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [listings, theme]);

  const mappableCount = listings.filter(l => {
    if (l.latitude && l.longitude) return true;
    return l.location && LOCALITY_COORDS[l.location];
  }).length;

  return (
    <div>
      <style>{`
        .search-map-container { height: 560px; border-radius: 10px; overflow: hidden; border: 1px solid var(--color-border); }
        @media (min-width: 769px) { .search-map-container { height: calc(100vh - 270px); min-height: 400px; } }
        @media (max-width: 768px) { .search-map-container { height: 58vh; min-height: 300px; } }
        .dark-popup .leaflet-popup-content-wrapper { background:#13131f!important;border:1px solid #2a2a3a!important;border-radius:10px!important;box-shadow:0 8px 32px rgba(0,0,0,0.8)!important;padding:0!important; }
        .dark-popup .leaflet-popup-content { margin:14px 16px!important; }
        .dark-popup .leaflet-popup-tip { background:#13131f!important; }
        .dark-popup .leaflet-popup-close-button { color:#4b5563!important;font-size:16px!important;padding:6px 8px!important;top:3px!important;right:3px!important; }
        .dark-popup .leaflet-popup-close-button:hover { color:#e8e4d8!important;background:none!important; }
        .light-popup .leaflet-popup-content-wrapper { background:#ffffff!important;border:1px solid #e5e7eb!important;border-radius:10px!important;box-shadow:0 8px 32px rgba(0,0,0,0.12)!important;padding:0!important; }
        .light-popup .leaflet-popup-content { margin:14px 16px!important; }
        .light-popup .leaflet-popup-tip { background:#ffffff!important; }
        .light-popup .leaflet-popup-close-button { color:#9ca3af!important;font-size:16px!important;padding:6px 8px!important;top:3px!important;right:3px!important; }
        .light-popup .leaflet-popup-close-button:hover { color:#374151!important;background:none!important; }
        [data-theme="light"] .leaflet-container { background:#e8ecf0; }
        [data-theme="light"] .leaflet-control-zoom a { background:#fff!important;color:#374151!important;border-color:#e5e7eb!important; }
        [data-theme="light"] .leaflet-control-zoom a:hover { background:#f3f4f6!important; }
        [data-theme="light"] .leaflet-control-attribution { background:rgba(255,255,255,0.8)!important;color:#9ca3af!important; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
          {mappableCount} of {listings.length} listings on map
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          {[['#E8A020', '70+ score'], ['rgba(232,160,32,0.6)', '50–69'], ['#555555', '<50']].map(([c, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="search-map-container" />
    </div>
  );
}

// ── Haversine distance (km) ───────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ── Geo-radius modal (bottom sheet) ──────────────────────────────────────────
const GEO_RADIUS_OPTIONS = [1, 2, 5, 10, 15, 20];

function GeoRadiusModal({ open, onClose, onApply, onClear, currentPin, currentRadius, currentLabel }) {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const markerRef       = useRef(null);
  const circleRef       = useRef(null);

  const [pin, setPin]           = useState(currentPin  || null);
  const [radius, setRadius]     = useState(currentRadius || 5);
  const [locInput, setLocInput] = useState('');
  const [suggestions, setSuggestions] = useState([]); // [{name, lat, lng}]
  const [searching, setSearching]     = useState(false);
  const debounceRef = useRef(null);

  // Sync incoming values when opening
  useEffect(() => {
    if (open) {
      setPin(currentPin || null);
      setRadius(currentRadius || 5);
      setLocInput(currentPin ? (currentLabel || '') : '');
      setSuggestions([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Init/destroy Leaflet map when sheet opens/closes
  useEffect(() => {
    if (!open) return;
    const L = window.L;
    if (!L) return;

    // Wait one tick for the container to mount
    const tid = setTimeout(() => {
      if (!mapContainerRef.current || mapRef.current) return;
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const tile = isDark
        ? 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png'
        : 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png';

      const initialCenter = currentPin ? [currentPin.lat, currentPin.lng] : [12.9716, 77.5946];
      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: currentPin ? 13 : 12,
        preferCanvas: true,
        zoomControl: false, // added manually below at bottom-right
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer(tile, { attribution: '© OSM contributors © CartoDB', maxZoom: 19 }).addTo(map);

      map.on('click', (e) => {
        setPin({ lat: e.latlng.lat, lng: e.latlng.lng });
      });

      mapRef.current = map;
    }, 80);

    return () => {
      clearTimeout(tid);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current  = null;
        markerRef.current = null;
        circleRef.current = null;
      }
    };
  }, [open]);

  // Update pin marker + radius circle whenever pin or radius changes
  useEffect(() => {
    const L   = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (circleRef.current) { circleRef.current.remove(); circleRef.current = null; }

    if (!pin) return;

    const label = locInput.trim();
    markerRef.current = L.marker([pin.lat, pin.lng], {
      icon: L.divIcon({
        html: `<div style="position:relative;width:28px;height:28px;">
          <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:#E8A020;transform:translateY(-50%);opacity:0.7;"></div>
          <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#E8A020;transform:translateX(-50%);opacity:0.7;"></div>
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
            width:12px;height:12px;border-radius:50%;
            background:#E8A020;border:2.5px solid #fff;
            box-shadow:0 2px 10px rgba(232,160,32,0.7);
          "></div>
          ${label ? `<div style="
            position:absolute;top:18px;left:50%;transform:translateX(-50%);
            color:#E8A020;
            font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;
            white-space:nowrap;
            text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.8);
            pointer-events:none;
          ">${label}</div>` : ''}
        </div>`,
        className: '',
        iconSize:   [28, 28],
        iconAnchor: [14, 14],
      }),
    }).addTo(map);

    circleRef.current = L.circle([pin.lat, pin.lng], {
      radius:      radius * 1000,
      color:       '#E8A020',
      weight:      1.5,
      fillColor:   '#E8A020',
      fillOpacity: 0.08,
      dashArray:   '5 5',
    }).addTo(map);

    // Fit the map view to the circle bounds so the full radius is always visible
    map.fitBounds(circleRef.current.getBounds(), { padding: [24, 24], maxZoom: 15 });
  }, [pin, radius, locInput]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLocInput(val) {
    setLocInput(val);
    clearTimeout(debounceRef.current);

    if (!val.trim() || val.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    // ── 1. Instant local results from known localities ────────────────────────
    const lower = val.toLowerCase();
    const localHits = Object.keys(LOCALITY_COORDS)
      .filter(k => k.toLowerCase().includes(lower))
      .slice(0, 3)
      .map(name => ({
        name,
        sub: 'Bangalore locality',
        lat: LOCALITY_COORDS[name][0],
        lng: LOCALITY_COORDS[name][1],
        local: true,
      }));
    setSuggestions(localHits);
    setSearching(true);

    // ── 2. Debounced Nominatim search (bounding box = Bangalore, no city suffix) ─
    debounceRef.current = setTimeout(async () => {
      try {
        const q       = encodeURIComponent(val.trim());
        const viewbox = '77.35,13.22,77.85,12.75'; // west, north, east, south
        const url     = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=7&countrycodes=in&viewbox=${viewbox}&bounded=0&addressdetails=1`;
        const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();

        const remote = data.map(r => {
          const parts = r.display_name.split(',');
          return {
            name: parts.slice(0, 2).join(', ').trim(),
            sub:  parts.slice(2, 4).join(', ').trim() || r.type,
            lat:  parseFloat(r.lat),
            lng:  parseFloat(r.lon),
            local: false,
          };
        });

        // Merge: local first, remote after (skip duplicates)
        const merged = [
          ...localHits,
          ...remote.filter(r =>
            !localHits.some(l => l.name.toLowerCase() === r.name.toLowerCase())
          ),
        ].slice(0, 8);

        setSuggestions(merged.length > 0 ? merged : [{ __empty: true }]);
      } catch {
        if (localHits.length === 0) setSuggestions([{ __empty: true }]);
      } finally {
        setSearching(false);
      }
    }, 380);
  }

  function pickSuggestion(s) {
    if (s.__empty) return;
    setPin({ lat: s.lat, lng: s.lng });
    setLocInput(s.name);
    setSuggestions([]);
  }

  if (!open) return null;

  const canApply = pin !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}
      />

      {/* Sheet */}
      <div className="geo-radius-modal-sheet" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2001,
        background: '#111111',
        borderRadius: '16px 16px 0 0',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
        animation: 'slideUp 0.25s ease-out',
      }}>
        {/* Drag handle */}
        <div className="geo-modal-drag-handle" style={{ display: 'flex', justifyContent: 'center', paddingTop: 14, paddingBottom: 6 }}>
          <div style={{ width: 40, height: 4, background: '#333', borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div style={{
          padding: '6px 20px 14px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 400, letterSpacing: '-0.01em' }}>
              Search by area
            </span>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 18, padding: 4 }}
            >×</button>
          </div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
            Type a landmark or tap anywhere on the map, then pick a radius to see only listings nearby.
          </p>
        </div>

        {/* Location input — lives OUTSIDE the scroll container so the dropdown isn't clipped.
            zIndex: 1100 beats Leaflet's control panes (.leaflet-top z-index:1000) which share
            the sheet's stacking context because .leaflet-container has no z-index of its own. */}
        <div style={{ position: 'relative', padding: '12px 20px 0', zIndex: 1100 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10, padding: '10px 14px',
          }}>
            <i className="fa-solid fa-magnifying-glass" style={{ color: 'var(--color-text-muted)', fontSize: 12 }} />
            <input
              value={locInput}
              onChange={e => handleLocInput(e.target.value)}
              onBlur={() => setTimeout(() => setSuggestions([]), 150)}
              placeholder="Locality or landmark…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontFamily: 'var(--font-sans)', fontSize: 14,
                color: 'var(--color-text-primary)',
              }}
            />
            {locInput && (
              <button
                onMouseDown={() => { setLocInput(''); setSuggestions([]); clearTimeout(debounceRef.current); setSearching(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, fontSize: 14 }}
              >×</button>
            )}
            {searching && (
              <i className="fa-solid fa-spinner fa-spin" style={{ color: 'var(--color-text-muted)', fontSize: 11 }} />
            )}
          </div>
          {suggestions.length > 0 && (
            <ul style={{
              position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 1000,
              margin: 0, padding: '4px 0', listStyle: 'none',
              background: '#16161f', border: '1px solid var(--color-border)',
              borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
            }}>
              {suggestions.map((s, i) => s.__empty ? (
                <li key="empty" style={{
                  padding: '14px 14px',
                  fontFamily: 'var(--font-sans)', fontSize: 13,
                  color: 'var(--color-text-muted)', fontStyle: 'italic',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <i className="fa-solid fa-circle-xmark" style={{ fontSize: 12, opacity: 0.5 }} />
                  Not found in map data — tap the map to pin manually
                </li>
              ) : (
                <li
                  key={i}
                  onMouseDown={() => pickSuggestion(s)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '9px 14px',
                    cursor: 'pointer',
                    borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(232,160,32,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <i
                    className={s.local ? 'fa-solid fa-map-pin' : 'fa-solid fa-location-dot'}
                    style={{ fontSize: 11, color: s.local ? '#E8A020' : 'var(--color-text-muted)', marginTop: 3, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.35 }}>
                      {s.name}
                    </div>
                    {s.sub && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', letterSpacing: '0.03em', marginTop: 1 }}>
                        {s.sub}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 0' }}>

          {/* Hint */}
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
            color: 'var(--color-text-muted)', marginBottom: 10,
            textAlign: 'center',
          }}>
            {pin ? '📍 Location set — adjust radius below' : 'Tap the map to pin any location'}
          </p>

          {/* Map */}
          <div
            ref={mapContainerRef}
            className="geo-modal-map"
            style={{
              height: 240, borderRadius: 10, overflow: 'hidden',
              border: '1px solid var(--color-border)', marginBottom: 16,
            }}
          />

          {/* Radius selector */}
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10,
          }}>Radius</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {GEO_RADIUS_OPTIONS.map(km => (
              <button
                key={km}
                onClick={() => setRadius(km)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.04em',
                  background: radius === km ? 'rgba(232,160,32,0.15)' : 'var(--color-bg-surface)',
                  color: radius === km ? '#E8A020' : 'var(--color-text-muted)',
                  border: `1px solid ${radius === km ? 'rgba(232,160,32,0.5)' : 'var(--color-border)'}`,
                  borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >{km} km</button>
            ))}
          </div>
        </div>

        {/* Footer buttons */}
        <div style={{
          display: 'flex', gap: 10, padding: '14px 20px 28px',
          borderTop: '1px solid var(--color-border)',
        }}>
          <button
            onClick={() => { onClear(); onClose(); }}
            style={{
              flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 10, padding: '12px 0', cursor: 'pointer',
            }}
          >Clear</button>
          <button
            onClick={() => { if (canApply) { onApply(pin, radius, locInput.trim()); onClose(); } }}
            disabled={!canApply}
            style={{
              flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
              background: canApply ? 'rgba(232,160,32,0.15)' : 'var(--color-bg-surface)',
              color: canApply ? '#E8A020' : 'var(--color-text-muted)',
              border: `1px solid ${canApply ? 'rgba(232,160,32,0.4)' : 'var(--color-border)'}`,
              borderRadius: 10, padding: '12px 0', cursor: canApply ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            {canApply ? `Show listings within ${radius} km` : 'Pin a location first'}
          </button>
        </div>
      </div>
    </>
  );
}

function SkeletonCard() {
  return (
    <article style={{
      background: 'var(--color-bg-surface)',
      borderRadius: 'var(--radius-card)',
      padding: '18px 20px',
      animation: 'pulse 1.6s ease-in-out infinite',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ width: 72, height: 20, background: 'var(--color-bg-card)', borderRadius: 4 }} />
        <div style={{ width: 52, height: 28, background: 'var(--color-bg-card)', borderRadius: 6 }} />
      </div>
      <div style={{ height: 16, background: 'var(--color-bg-card)', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ height: 16, background: 'var(--color-bg-card)', borderRadius: 4, width: '70%', marginBottom: 12 }} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[60, 80, 100].map(w => (
          <div key={w} style={{ width: w, height: 24, background: 'var(--color-bg-card)', borderRadius: 4 }} />
        ))}
      </div>
      <div style={{ height: 14, background: 'var(--color-bg-card)', borderRadius: 4, width: '45%' }} />
    </article>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore complex state from sessionStorage only when returning to the same search query
  // (prevents stale geo/filters from bleeding into a fresh search for a different area)
  const _saved = (() => {
    try {
      const s = JSON.parse(sessionStorage.getItem('nestiq_search') || '{}');
      return s._q === (searchParams.get('q') || '') ? s : {};
    } catch { return {}; }
  })();

  const [query, setQuery]             = useState(searchParams.get('q') || '');
  const [view, setView]               = useState(_saved.view  || searchParams.get('view') || 'grid');
  const [sort, setSort]               = useState(_saved.sort  || searchParams.get('sort') || 'Score');
  const [activeFilters, setActiveFilters] = useState(() => _saved.activeFilters ?? ({
    ...DEFAULT_FILTERS,
    sources: { ...DEFAULT_FILTERS.sources },
  }));
  const [sheetOpen, setSheetOpen]     = useState(false);
  const [geoOpen, setGeoOpen]         = useState(false);
  const [geoPin, setGeoPin]           = useState(_saved.geoPin    ?? null);
  const [geoRadius, setGeoRadius]     = useState(_saved.geoRadius ?? 5);
  const [geoActive, setGeoActive]     = useState(_saved.geoActive ?? false);
  const [geoLabel, setGeoLabel]       = useState(_saved.geoLabel  ?? '');
  const isDesktop = useDesktop();
  const [activeLocality, setActiveLocality] = useState(null);
  const [quickFilters, setQuickFilters]     = useState(new Set());
  const [areaSuggestions, setAreaSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const areaInputRef    = useRef(null);
  const pillsRowRef     = useRef(null);
  const wasLoadingRef   = useRef(false);
  const [progressState, setProgressState] = useState('idle'); // 'idle' | 'running' | 'completing'
  const [listings, setListings]       = useState([]);
  const [total, setTotal]             = useState(0);
  // sourceCounts is derived from `displayed` after all client-side filters run (see below)
  const [loading, setLoading]         = useState(false);
  const [isTopPicks, setIsTopPicks]   = useState(false);
  const [page, setPage]               = useState(Number(searchParams.get('page')) || 1);
  const PAGE_SIZE = isDesktop ? 12 : 10;
  // savedIds kept for optimistic UI before useSavedListings hydrates
  const [savedIds, setSavedIds]       = useState(new Set());

  // ── Auth + search logging ───────────────────────────────────────────────────
  const { user, signInWithGoogle }    = useAuth();
  const { isSaved, saveListing }      = useSavedListings(user);
  const {
    logSearch, runTriggerChecks, onListingSaved,
    toast, dismissToast,
  } = useSearchLogs(user);

  // Refs so doSearch (useCallback []) always calls the latest log functions
  const logSearchRef        = useRef(logSearch);
  const runTriggerRef       = useRef(runTriggerChecks);
  useEffect(() => { logSearchRef.current = logSearch; },        [logSearch]);
  useEffect(() => { runTriggerRef.current = runTriggerChecks; }, [runTriggerChecks]);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const doSearch = useCallback(async (area) => {
    setLoading(true);
    const isDefaultLoad = !area;
    const params = new URLSearchParams({
      sources:   'reddit,telegram,nobroker,housing',
      sort:      'score',
      min_score: isDefaultLoad ? 40 : 20,
      limit:     isDefaultLoad ? 20 : 50,
      ...(area ? { area } : {}),
    });
    try {
      const res  = await fetch(`${API_BASE}/api/search?${params}`);
      const data = await res.json();
      const posts = (data.posts || []).map(normalizePost);
      setListings(posts);
      setTotal(data.total ?? posts.length);
      setIsTopPicks(isDefaultLoad);
      setPage(1);
      // Source counts are now derived from `displayed` (after all client-side filters)
      // so we no longer compute them here from the raw API response.
      // Log the search and check auto-save triggers
      await logSearchRef.current(area, {});
      runTriggerRef.current(area);
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    doSearch(searchParams.get('q') || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync navigational state to URL so Back restores it ──────────────────────
  useEffect(() => {
    const p = {};
    if (query) p.q = query;
    if (sort !== 'Score') p.sort = sort;
    if (page > 1) p.page = String(page);
    if (view !== 'grid') p.view = view;
    setSearchParams(p, { replace: true });
  }, [query, sort, page, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist complex state to sessionStorage (restored on Back navigation) ───
  useEffect(() => {
    try {
      sessionStorage.setItem('nestiq_search', JSON.stringify({
        _q: query,
        sort, view,
        activeFilters,
        geoPin, geoRadius, geoActive, geoLabel,
      }));
    } catch { /* storage full / private mode */ }
  }, [query, sort, view, activeFilters, geoPin, geoRadius, geoActive, geoLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrapper: any user-initiated locality search clears the geo-radius filter
  function doLocalitySearch(area) {
    setGeoActive(false);
    setGeoPin(null);
    doSearch(area);
  }

  // ── Progress bar state machine ───────────────────────────────────────────────
  useEffect(() => {
    if (loading && !wasLoadingRef.current) {
      wasLoadingRef.current = true;
      setProgressState('running');
    } else if (!loading && wasLoadingRef.current) {
      wasLoadingRef.current = false;
      setProgressState('completing');
      const t = setTimeout(() => setProgressState('idle'), 600);
      return () => clearTimeout(t);
    }
  }, [loading]);

  function toggleSave(listing) {
    // Optimistic local state
    setSavedIds(prev => {
      const next = new Set(prev);
      next.has(listing.id) ? next.delete(listing.id) : next.add(listing.id);
      return next;
    });

    // Persist to Supabase (or localStorage if anonymous)
    saveListing({
      id:            listing.id,
      title:         listing.title,
      source:        listing.rawSource,
      url:           listing.url,
      price:         listing.rawRent,
      rent:          listing.rawRent,
      locality:      listing.location,
      bhk:           listing.bhk,
      area_sqft:     listing.sqft ? listing.sqft.replace(/,/g, '') : null,
      furnishing:    listing.furnished,
      quality_score: listing.score,
      created:       listing.rawCreated,
    });

    // Trigger 1 — auto-save the current search when user saves a listing
    if (!isSaved(listing.id)) {
      onListingSaved(query);
    }
  }

  // ── Derive display pills from activeFilters ─────────────────────────────────
  const activePills = [];
  activeFilters.bhk.forEach(b => activePills.push(b === 'Studio' ? 'Studio' : `${b} BHK`));
  if (activeFilters.minBudget || activeFilters.maxBudget) {
    const min = activeFilters.minBudget ? `₹${(Number(activeFilters.minBudget) / 1000).toFixed(0)}k` : '₹0';
    const max = activeFilters.maxBudget ? `₹${(Number(activeFilters.maxBudget) / 1000).toFixed(0)}k` : '∞';
    activePills.push(`${min}–${max}`);
  }
  if (activeFilters.furnished !== 'Any') activePills.push(activeFilters.furnished);
  if (activeFilters.keywords) activePills.push(`"${activeFilters.keywords}"`);
  // Skip source pills for sources that are already covered by the community quick filter
  const communityActive = quickFilters.has('community');
  Object.entries(SOURCE_CONFIG).forEach(([key, cfg]) => {
    if (!activeFilters.sources[key]) {
      if (communityActive && (key === 'nobroker' || key === 'housing')) return;
      activePills.push(`No ${cfg.label}`);
    }
  });

  function removePill(label) {
    if (label === 'Studio' || label.endsWith('BHK')) {
      const b = label === 'Studio' ? 'Studio' : label.replace(' BHK', '');
      setActiveFilters(f => ({ ...f, bhk: f.bhk.filter(x => x !== b) }));
    } else if (label.startsWith('₹') || label.includes('k')) {
      setActiveFilters(f => ({ ...f, minBudget: '', maxBudget: '' }));
    } else if (label === 'Furnished' || label === 'Unfurnished') {
      setActiveFilters(f => ({ ...f, furnished: 'Any' }));
    } else if (label.startsWith('"')) {
      setActiveFilters(f => ({ ...f, keywords: '' }));
    } else if (label.startsWith('No ')) {
      const srcLabel = label.replace('No ', '');
      const key = Object.entries(SOURCE_CONFIG).find(([, cfg]) => cfg.label === srcLabel)?.[0];
      if (key) setActiveFilters(f => ({ ...f, sources: { ...f.sources, [key]: true } }));
    }
  }

  function handleApply({ filters, sort: newSort }) {
    setActiveFilters(filters);
    setSort(newSort);
    setPage(1);
  }

  function toggleSourceFilter(rawSource) {
    // If community filter is active and user re-enables nobroker or housing,
    // treat it as "exit community mode" and turn that source back on
    if (quickFilters.has('community') && (rawSource === 'nobroker' || rawSource === 'housing')) {
      setQuickFilters(prev => { const n = new Set(prev); n.delete('community'); return n; });
      setActiveFilters(prev => ({
        ...prev,
        sources: { ...prev.sources, nobroker: true, housing: true },
      }));
    } else {
      setActiveFilters(prev => ({
        ...prev,
        sources: { ...prev.sources, [rawSource]: !prev.sources[rawSource] },
      }));
    }
    setPage(1);
  }

  // ── Client-side sort ────────────────────────────────────────────────────────
  const sorted = [...listings].sort((a, b) => {
    if (sort === 'Score')  return b.score - a.score;
    if (sort === 'Newest') return b.rawCreated - a.rawCreated;
    return 0;
  });

  // ── Client-side filter ──────────────────────────────────────────────────────
  const displayed = sorted.filter(listing => {
    // BHK
    if (activeFilters.bhk.length > 0) {
      const bhkStr = (listing.bhk || '').toLowerCase().replace(/\s+/g, '');
      const matched = activeFilters.bhk.some(s => {
        if (s === 'Studio') return bhkStr.includes('studio') || bhkStr.includes('1rk');
        if (s === '4+')     return /^[4-9]/.test(bhkStr);
        return bhkStr.startsWith(`${s}bhk`);
      });
      if (!matched) return false;
    }
    // Budget
    const rent = listing.rawRent;
    if (rent != null) {
      if (activeFilters.minBudget && Number(activeFilters.minBudget) > 0 && rent < Number(activeFilters.minBudget)) return false;
      if (activeFilters.maxBudget && Number(activeFilters.maxBudget) > 0 && rent > Number(activeFilters.maxBudget)) return false;
    }
    // Furnished
    const furnished = (listing.furnished || '').toLowerCase();
    if (activeFilters.furnished === 'Furnished'   && !furnished.includes('furnished')) return false;
    if (activeFilters.furnished === 'Unfurnished' && furnished !== 'unfurnished')      return false;
    // Keywords
    if (activeFilters.keywords) {
      if (!listing.title.toLowerCase().includes(activeFilters.keywords.toLowerCase())) return false;
    }
    // Sources
    if (!activeFilters.sources[listing.rawSource]) return false;
    // Quick filters — OR within category, AND across categories
    if (quickFilters.size > 0) {
      const qBhk      = (listing.bhk || '').toLowerCase().replace(/\s+/g, '');
      const qFurnished = (listing.furnished || '').toLowerCase();
      const qRent      = listing.rawRent;

      const matchesKey = key => {
        if (key === '1bhk')      return qBhk.startsWith('1bhk');
        if (key === '2bhk')      return qBhk.startsWith('2bhk');
        if (key === '3bhk')      return qBhk.startsWith('3bhk');
        if (key === 'furnished') return qFurnished.includes('fully');
        if (key === 'semi')      return qFurnished.includes('semi');
        if (key === 'u20k')      return qRent == null || qRent < 20000;
        if (key === 'u35k')      return qRent == null || qRent < 35000;
        if (key === 'u50k')      return qRent == null || qRent < 50000;
        if (key === 'community') return listing.rawSource === 'reddit' || listing.rawSource === 'telegram';
        if (key === 'high_score')return listing.score >= 70;
        return true;
      };

      // Group active keys by category, then AND across groups
      const byCategory = {};
      for (const f of QUICK_FILTERS) {
        if (quickFilters.has(f.key)) {
          (byCategory[f.category] = byCategory[f.category] || []).push(f.key);
        }
      }
      for (const keys of Object.values(byCategory)) {
        if (!keys.some(matchesKey)) return false;
      }
    }
    // Geo-radius filter
    if (geoActive && geoPin) {
      const lat2 = listing.latitude  ?? (listing.location ? (LOCALITY_COORDS[listing.location] || [])[0] : null);
      const lng2 = listing.longitude ?? (listing.location ? (LOCALITY_COORDS[listing.location] || [])[1] : null);
      if (lat2 == null || lng2 == null) return false;
      if (haversineKm(geoPin.lat, geoPin.lng, lat2, lng2) > geoRadius) return false;
    }
    return true;
  });

  const pageCount  = Math.ceil(displayed.length / PAGE_SIZE);
  const paginated  = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Source counts from all results (before source filter) — so pills persist when a source is deselected
  const allSourceCounts = sorted.reduce((acc, l) => {
    // Only count listings that pass non-source filters (BHK, budget, furnished, keywords, geo, quick)
    const label = SOURCE_LABELS[l.rawSource] || l.rawSource;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  // sourceCounts keeps track of how many are actually shown (post source-filter) — used for count display
  const sourceCounts = displayed.reduce((acc, l) => {
    const label = SOURCE_LABELS[l.rawSource] || l.rawSource;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const viewIcons = [
    { key: 'list', label: '≡' },
    { key: 'grid', label: '⊞' },
    { key: 'map',  label: '⊙' },
  ];

  const monoLabel = {
    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10,
  };

  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-sans)',
      minHeight: '100vh',
      paddingBottom: isDesktop ? 0 : 80,
      marginLeft: isDesktop ? 240 : 0,
    }}>
      <DesktopSidebar />
      <AppHeader />

      {isDesktop ? (
        /* ══════════════════════ DESKTOP TWO-COLUMN ══════════════════════ */
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>

          {/* ── LEFT PANEL: search + filters ── */}
          <div style={{
            width: 320, flexShrink: 0,
            position: 'sticky', top: 56,
            height: 'calc(100vh - 56px)',
            overflowY: 'auto',
            borderRight: '0.5px solid var(--color-border)',
            padding: '16px 16px 32px',
            scrollbarWidth: 'none',
            background: 'var(--color-bg-primary)',
          }}>

            {/* Search input */}
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-pill)',
                padding: '10px 14px',
              }}>
                <i className="fa-solid fa-location-dot" style={{ color: 'var(--color-text-muted)', fontSize: 13 }} />
                <input
                  ref={areaInputRef}
                  type="search"
                  value={query}
                  autoComplete="off"
                  onChange={e => {
                    const val = e.target.value;
                    setQuery(val);
                    setActiveSuggestion(-1);
                    if (val.trim().length >= 2) {
                      const lower = val.toLowerCase();
                      const matches = BANGALORE_AREAS.filter(a => a.toLowerCase().includes(lower)).slice(0, 8);
                      setAreaSuggestions(matches);
                      setShowSuggestions(matches.length > 0);
                    } else {
                      setAreaSuggestions([]);
                      setShowSuggestions(false);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { setShowSuggestions(false); doLocalitySearch(query); }
                    else if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Locality…"
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    fontFamily: 'var(--font-sans)', fontSize: 14,
                    color: 'var(--color-text-primary)', minWidth: 0,
                  }}
                />
                <button
                  onClick={() => { setShowSuggestions(false); doLocalitySearch(query); }}
                  style={{
                    background: 'var(--color-amber)', color: '#1a0a00',
                    border: 'none', borderRadius: 20, padding: '6px 14px',
                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', flexShrink: 0,
                  }}
                >
                  Search
                </button>
              </div>
              {/* Suggestions */}
              {showSuggestions && areaSuggestions.length > 0 && (
                <ul style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: '#1a1a1a', border: '1px solid var(--color-border)',
                  borderRadius: 10, zIndex: 200, listStyle: 'none',
                  margin: '4px 0 0', padding: 0, overflow: 'hidden',
                }}>
                  {areaSuggestions.map((s, i) => (
                    <li
                      key={s}
                      onMouseDown={() => { setQuery(s); setShowSuggestions(false); doLocalitySearch(s); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px', fontSize: 13, cursor: 'pointer',
                        background: i === activeSuggestion ? 'rgba(232,160,32,0.1)' : 'transparent',
                        color: i === activeSuggestion ? 'var(--color-amber)' : 'var(--color-text-primary)',
                        borderBottom: i < areaSuggestions.length - 1 ? '1px solid var(--color-border)' : 'none',
                      }}
                    >
                      <i className="fa-solid fa-location-dot" style={{ fontSize: 11, color: 'var(--color-text-muted)' }} />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Locality quick-chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {LOCALITY_CHIPS.map(({ label, icon }) => {
                const active = activeLocality === label;
                return (
                  <button
                    key={label}
                    onClick={() => {
                      if (active) { setActiveLocality(null); setQuery(''); doSearch(''); }
                      else { setActiveLocality(label); setQuery(label); doLocalitySearch(label); }
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      height: 30, fontFamily: 'var(--font-sans)', fontSize: 12,
                      background: active ? '#1A1200' : '#120F00',
                      color: active ? '#E8A020' : '#AAA',
                      border: active ? '0.5px solid #E8A020' : '0.5px solid #3A3000',
                      borderRadius: 8, padding: '0 10px', cursor: 'pointer', whiteSpace: 'nowrap',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    <FontAwesomeIcon icon={icon} style={{ fontSize: 11 }} />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* ─ FILTERS ─ */}
            <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 16 }}>
              <p style={{ ...monoLabel, marginBottom: 14 }}>Filters</p>

              {/* BHK */}
              <div style={{ marginBottom: 16 }}>
                <p style={monoLabel}>BHK</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {BHK_OPTIONS.map(opt => (
                    <PillToggle
                      key={opt} label={opt}
                      active={activeFilters.bhk.includes(opt)}
                      onClick={() => setActiveFilters(f => ({
                        ...f,
                        bhk: f.bhk.includes(opt) ? f.bhk.filter(b => b !== opt) : [...f.bhk, opt],
                      }))}
                    />
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div style={{ marginBottom: 16 }}>
                <p style={monoLabel}>Budget</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <BudgetInput placeholder="Min ₹" value={activeFilters.minBudget} onChange={v => setActiveFilters(f => ({ ...f, minBudget: v }))} />
                  <BudgetInput placeholder="Max ₹" value={activeFilters.maxBudget} onChange={v => setActiveFilters(f => ({ ...f, maxBudget: v }))} />
                </div>
              </div>

              {/* Furnished */}
              <div style={{ marginBottom: 16 }}>
                <p style={monoLabel}>Furnished</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {FURNISHED_OPTIONS.map(opt => (
                    <PillToggle
                      key={opt} label={opt}
                      active={activeFilters.furnished === opt}
                      onClick={() => setActiveFilters(f => ({ ...f, furnished: opt }))}
                    />
                  ))}
                </div>
              </div>

              {/* Sources */}
              <div style={{ marginBottom: 16 }}>
                <p style={monoLabel}>Sources</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(SOURCE_CONFIG).map(([key, cfg]) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={activeFilters.sources[key] !== false}
                        onChange={() => setActiveFilters(f => ({ ...f, sources: { ...f.sources, [key]: !f.sources[key] } }))}
                        style={{ accentColor: 'var(--color-amber)', width: 14, height: 14 }}
                      />
                      <i className={cfg.icon} style={{ fontSize: 12, color: cfg.color, width: 14, textAlign: 'center' }} />
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-text-muted)' }}>{cfg.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Nearby radius */}
              <div style={{ marginBottom: 16 }}>
                <p style={monoLabel}>Nearby</p>
                {geoActive && geoPin ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'rgba(232,160,32,0.08)',
                    border: '1px solid rgba(232,160,32,0.3)',
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#E8A020', letterSpacing: '0.04em' }}>
                      <i className="fa-solid fa-location-dot" style={{ marginRight: 6 }} />
                      Within {geoRadius} km
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setGeoOpen(true)}
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.05em',
                          background: 'none', border: '1px solid rgba(232,160,32,0.3)',
                          color: '#E8A020', borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                        }}
                      >Edit</button>
                      <button
                        onClick={() => { setGeoActive(false); setGeoPin(null); }}
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10,
                          background: 'none', border: '1px solid var(--color-border)',
                          color: 'var(--color-text-muted)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                        }}
                      >Clear</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setGeoOpen(true)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      fontFamily: 'var(--font-sans)', fontSize: 13,
                      background: 'var(--color-bg-surface)',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8, padding: '9px 12px', cursor: 'pointer',
                      transition: 'border-color 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-text-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                  >
                    <i className="fa-solid fa-location-dot" style={{ fontSize: 12 }} />
                    Set location &amp; radius…
                  </button>
                )}
              </div>

              {/* Sort */}
              <div style={{ marginBottom: 20 }}>
                <p style={monoLabel}>Sort</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {SORT_OPTIONS.map(opt => (
                    <PillToggle key={opt} label={opt} active={sort === opt} onClick={() => setSort(opt)} />
                  ))}
                </div>
              </div>

              {/* Reset */}
              <button
                onClick={() => {
                  setActiveFilters({ ...DEFAULT_FILTERS, sources: { ...DEFAULT_FILTERS.sources } });
                  setQuickFilters(new Set());
                  setSort('Score');
                }}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', background: 'none',
                  border: '1px solid var(--color-border)', borderRadius: 8,
                  padding: '7px 14px', cursor: 'pointer', color: 'var(--color-text-muted)',
                  width: '100%', transition: 'border-color 0.2s, color 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-text-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
              >
                Reset filters
              </button>
            </div>

          </div>{/* end left panel */}

          {/* ── RIGHT PANEL: results ── */}
          <div style={{ flex: 1, minWidth: 0, padding: '16px 20px 40px' }}>

            {/* Results header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 style={{ fontWeight: 300, fontSize: 20, letterSpacing: '-0.025em', marginBottom: 4 }}>
                  {loading ? '…' : geoActive ? `${displayed.length} homes within ${geoRadius} km${geoLabel ? ` of ${geoLabel}` : ''}` : query.trim() ? `${displayed.length} homes in ${query.trim()}` : isTopPicks ? 'Top picks · Bangalore' : `${displayed.length} homes`}
                </h1>
                {!loading && !isTopPicks && (() => {
                  const searched = query.trim().toLowerCase();
                  const others = [...new Set(displayed.map(l => l.location).filter(loc => loc && loc.toLowerCase() !== searched))].slice(0, 4);
                  if (others.length === 0) return null;
                  return <NearbyDropdown localities={others} />;
                })()}
              </div>
              <div style={{ display: 'flex', gap: 2, background: 'var(--color-bg-surface)', borderRadius: 8, padding: 3 }}>
                {viewIcons.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    style={{
                      background: view === key ? 'var(--color-bg-card)' : 'transparent',
                      border: 'none', borderRadius: 6, padding: '5px 10px',
                      cursor: 'pointer', color: view === key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                      fontSize: 16, transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source breakdown */}
            {!loading && Object.keys(allSourceCounts).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {Object.entries(allSourceCounts).map(([label, totalCount]) => {
                  const rawSource = Object.keys(SOURCE_CONFIG).find(k => SOURCE_CONFIG[k].label === label);
                  const cfg = (rawSource && SOURCE_CONFIG[rawSource]) || { color: '#666', icon: 'fa-solid fa-circle' };
                  const active = rawSource ? activeFilters.sources[rawSource] !== false : true;
                  const shownCount = sourceCounts[label] ?? 0;
                  if (active && shownCount === 0) return null;
                  return (
                    <button
                      key={label}
                      onClick={() => rawSource && toggleSourceFilter(rawSource)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
                        border: `1px solid ${active ? cfg.color + '55' : 'var(--color-border)'}`,
                        background: active ? cfg.color + '11' : 'transparent',
                        color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                        borderRadius: 20, padding: '4px 10px', cursor: 'pointer',
                        opacity: active ? 1 : 0.4,
                        transition: 'all 0.15s',
                      }}
                    >
                      <i className={cfg.icon} style={{ fontSize: 10, color: active ? cfg.color : 'inherit' }} />
                      <span style={{ fontWeight: 500 }}>{active ? shownCount : totalCount}</span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Results */}
            {loading ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : view === 'map' ? (
              <SearchMapView listings={displayed} />
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: view === 'list' ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
                  {paginated.map(listing => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      saved={isSaved(listing.id) || savedIds.has(listing.id)}
                      onToggleSave={() => toggleSave(listing)}
                    />
                  ))}
                </div>
                {pageCount > 1 && <PaginationBar page={page} pageCount={pageCount} onPageChange={setPage} />}
              </>
            )}

          </div>{/* end right panel */}

        </div>/* end desktop two-column */
      ) : (
        /* ══════════════════════ MOBILE LAYOUT ══════════════════════════ */
        <>

      {/* ── STICKY SEARCH BAR ── */}
      <div style={{
        position: 'sticky',
        top: 56,
        zIndex: 50,
        background: 'rgba(10,10,10,0.92)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 16px',
      }}>
        {/* Progress bar */}
        {progressState !== 'idle' && (
          <div style={{
            position: 'absolute',
            bottom: -1,
            left: 0,
            right: 0,
            height: 2,
            overflow: 'hidden',
            zIndex: 1,
            opacity: progressState === 'completing' ? 0 : 1,
            transition: progressState === 'completing' ? 'opacity 0.4s ease' : 'none',
          }}>
            {progressState === 'running' && (
              <div style={{
                position: 'absolute',
                top: 0,
                height: '100%',
                background: 'var(--color-amber)',
                borderRadius: 2,
                animation: 'progressSlide 1.1s ease-in-out infinite',
              }} />
            )}
            {progressState === 'completing' && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '100%',
                background: 'var(--color-amber)',
              }} />
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>

          {/* Search pill — flex: 1 so it fills available space */}
          <div style={{ flex: 1, position: 'relative' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-pill)',
              padding: '10px 16px',
            }}>
              <i className="fa-solid fa-location-dot" style={{ color: 'var(--color-text-muted)', fontSize: 14 }} />
              <input
              ref={areaInputRef}
              type="text"
              value={query}
              autoComplete="off"
              onChange={e => {
                const val = e.target.value;
                setQuery(val);
                setActiveSuggestion(-1);
                if (val.trim().length >= 2) {
                  const lower = val.toLowerCase();
                  const matches = BANGALORE_AREAS.filter(a =>
                    a.toLowerCase().includes(lower)
                  ).slice(0, 8);
                    setAreaSuggestions(matches);
                    setShowSuggestions(matches.length > 0);
                  } else {
                    setAreaSuggestions([]);
                    setShowSuggestions(false);
                  }
                }}
                onKeyDown={e => {
                  if (showSuggestions) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveSuggestion(i => Math.min(i + 1, areaSuggestions.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveSuggestion(i => Math.max(i - 1, -1));
                    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
                      e.preventDefault();
                      const chosen = areaSuggestions[activeSuggestion];
                      setQuery(chosen);
                      setShowSuggestions(false);
                      setActiveSuggestion(-1);
                      doLocalitySearch(chosen);
                    } else if (e.key === 'Escape') {
                      setShowSuggestions(false);
                    } else if (e.key === 'Enter') {
                      setShowSuggestions(false);
                      doLocalitySearch(query);
                    }
                  } else if (e.key === 'Enter') {
                    doLocalitySearch(query);
                  }
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => { if (areaSuggestions.length > 0) setShowSuggestions(true); }}
                placeholder="Koramangala, Indiranagar, HSR Layout..."
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                  color: 'var(--color-text-primary)',
                  minWidth: 0,
                  WebkitAppearance: 'none',
                }}
              />
              {query && (
                <button
                  onMouseDown={e => { e.preventDefault(); setQuery(''); setActiveLocality(null); doSearch(''); setShowSuggestions(false); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-amber)', fontSize: 16, padding: '0 2px',
                    display: 'flex', alignItems: 'center', lineHeight: 1,
                  }}
                  aria-label="Clear search"
                >×</button>
              )}
              <button
                onClick={() => { setShowSuggestions(false); doLocalitySearch(query); }}
                style={{
                  background: 'none',
                  border: '1px solid var(--color-amber)',
                  borderRadius: 8,
                  padding: '6px 13px',
                  cursor: 'pointer',
                  color: 'var(--color-amber)',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                }}
                aria-label="Search"
              >
                <i className={loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-magnifying-glass'} />
              </button>
            </div>

            {/* Autocomplete dropdown — positioned relative to the search pill only */}
            {showSuggestions && (
            <ul style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              zIndex: 200,
              margin: 0,
              padding: 0,
              listStyle: 'none',
              background: '#111111',
              border: '1px solid rgba(232,160,32,0.25)',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              {areaSuggestions.map((s, i) => (
                <li
                  key={s}
                  onMouseDown={() => {
                    setQuery(s);
                    setShowSuggestions(false);
                    setActiveSuggestion(-1);
                    doLocalitySearch(s);
                  }}
                  onMouseEnter={() => setActiveSuggestion(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '11px 16px',
                    fontSize: 13,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    background: i === activeSuggestion ? 'rgba(232,160,32,0.1)' : 'transparent',
                    color: i === activeSuggestion ? 'var(--color-amber)' : 'var(--color-text-primary)',
                    borderBottom: i < areaSuggestions.length - 1 ? '1px solid var(--color-border)' : 'none',
                    transition: 'background 0.1s',
                  }}
                >
                  <i className="fa-solid fa-location-dot" style={{
                    fontSize: 11,
                    color: i === activeSuggestion ? 'var(--color-amber)' : 'var(--color-text-muted)',
                  }} />
                  {s}
                </li>
              ))}
            </ul>
          )}
          </div>{/* end search pill wrapper */}

          {/* NEARBY — soft rounded square button, same row as search */}
          <button
            onClick={() => setGeoOpen(true)}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              background: geoActive ? 'rgba(232,160,32,0.12)' : 'rgba(232,160,32,0.05)',
              border: geoActive ? '1px solid rgba(232,160,32,0.4)' : '1px solid rgba(232,160,32,0.2)',
              borderRadius: 12,
              padding: '0 14px',
              height: 44,
              cursor: 'pointer',
              color: geoActive ? 'var(--color-amber)' : '#B08040',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!geoActive) { e.currentTarget.style.borderColor = 'rgba(232,160,32,0.4)'; e.currentTarget.style.color = 'var(--color-amber)'; e.currentTarget.style.background = 'rgba(232,160,32,0.1)'; } }}
            onMouseLeave={e => { if (!geoActive) { e.currentTarget.style.borderColor = 'rgba(232,160,32,0.2)'; e.currentTarget.style.color = '#B08040'; e.currentTarget.style.background = 'rgba(232,160,32,0.05)'; } }}
            aria-label="Search by area"
          >
            <i className="fa-solid fa-map" style={{ fontSize: 13 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em' }}>
              {geoActive ? `${geoRadius} km` : 'Nearby'}
            </span>
          </button>

        </div>{/* end flex row */}

      </div>

      {/* ── ROW 1: LOCALITY CHIPS ── */}
      <div style={{
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 12,
        display: 'flex',
        gap: 8,
      }}>
        {LOCALITY_CHIPS.map(({ label, icon }) => {
          const active = activeLocality === label;
          return (
            <button
              key={label}
              onClick={() => {
                if (active) {
                  setActiveLocality(null);
                  setQuery('');
                  doSearch('');
                } else {
                  setActiveLocality(label);
                  setQuery(label);
                  doLocalitySearch(label);
                }
              }}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 36,
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                background: active ? '#1A1200' : '#120F00',
                color: active ? '#E8A020' : '#AAA',
                border: active ? '0.5px solid #E8A020' : '0.5px solid #3A3000',
                borderRadius: 10,
                padding: '0 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
            >
              <FontAwesomeIcon
                icon={icon}
                style={{ fontSize: 12, color: active ? '#E8A020' : '#666' }}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── ROW 2: QUICK FILTER PILLS ── */}
      <div ref={pillsRowRef} style={{
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 0,
        display: 'flex',
        gap: 8,
        marginBottom: 6,
      }}>
        {/* Filters gateway pill */}
        <button
          onClick={() => setSheetOpen(true)}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.05em',
            background: '#1A1A1A',
            color: '#888',
            border: '0.5px solid #2A2A2A',
            borderRadius: 99,
            padding: '5px 14px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          ⚙ Filters
          {activePills.length > 0 && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--color-amber)',
              display: 'inline-block', flexShrink: 0,
            }} />
          )}
          {' '}▼
        </button>

        {/* Geo-radius quick switcher pills (plain toggles — no × here, dismiss via Row 3) */}
        {geoActive && geoPin && [1, 2, 5, 10].map(km => {
          const isCurrent = geoRadius === km;
          return (
            <button
              key={km}
              onClick={() => { setGeoRadius(km); setPage(1); }}
              style={{
                flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
                background: isCurrent ? 'rgba(232,160,32,0.15)' : 'transparent',
                color: isCurrent ? '#E8A020' : '#888',
                border: `0.5px solid ${isCurrent ? 'rgba(232,160,32,0.45)' : '#333'}`,
                borderRadius: 99, padding: '5px 10px',
                cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'all 0.12s',
              }}
            >
              {km} km
            </button>
          );
        })}

        {/* Quick toggle pills — fixed order, subtle active state */}
        {QUICK_FILTERS.map(({ key, label }) => {
          const active = quickFilters.has(key);
          return (
            <button
              key={key}
              onClick={() => {
                const turning_on = !quickFilters.has(key);
                setQuickFilters(prev => {
                  const next = new Set(prev);
                  turning_on ? next.add(key) : next.delete(key);
                  if (key === 'community') {
                    setActiveFilters(f => ({
                      ...f,
                      sources: {
                        ...f.sources,
                        nobroker: !turning_on,
                        housing:  !turning_on,
                      },
                    }));
                  }
                  return next;
                });
                setPage(1);
              }}
              style={{
                flexShrink: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.05em',
                background: active ? 'rgba(232,160,32,0.12)' : '#1A1A1A',
                color: active ? '#E8A020' : '#888',
                border: `0.5px solid ${active ? 'rgba(232,160,32,0.35)' : '#2A2A2A'}`,
                borderRadius: 99,
                padding: '5px 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── ROW 3: ACTIVE FILTER CHIPS ── only visible when something is on */}
      {(geoActive || quickFilters.size > 0 || activePills.length > 0) && (
        <div style={{
          overflowX: 'auto',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 12,
          paddingRight: 12,
          paddingBottom: 10,
          paddingTop: 2,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--color-text-muted)',
            flexShrink: 0, paddingRight: 2,
          }}>Active:</span>

          {/* Geo chip */}
          {geoActive && geoPin && (
            <span style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
              background: 'rgba(232,160,32,0.1)', color: '#E8A020',
              border: '0.5px solid rgba(232,160,32,0.4)',
              borderRadius: 99, padding: '4px 10px', whiteSpace: 'nowrap',
            }}>
              <i className="fa-solid fa-location-dot" style={{ fontSize: 9 }} />
              {geoRadius} km
              <button
                onClick={() => { setGeoActive(false); setGeoPin(null); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#E8A020', padding: 0, fontSize: 13, lineHeight: 1,
                  opacity: 0.7, display: 'flex', alignItems: 'center',
                }}
              >×</button>
            </span>
          )}

          {/* Quick filter chips */}
          {QUICK_FILTERS.filter(f => quickFilters.has(f.key)).map(({ key, label }) => (
            <span key={key} style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
              background: 'rgba(232,160,32,0.1)', color: '#E8A020',
              border: '0.5px solid rgba(232,160,32,0.4)',
              borderRadius: 99, padding: '4px 10px', whiteSpace: 'nowrap',
            }}>
              {label}
              <button
                onClick={() => {
                  setQuickFilters(prev => { const n = new Set(prev); n.delete(key); return n; });
                  if (key === 'community') {
                    setActiveFilters(f => ({ ...f, sources: { ...f.sources, nobroker: true, housing: true } }));
                  }
                  setPage(1);
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#E8A020', padding: 0, fontSize: 13, lineHeight: 1,
                  opacity: 0.7, display: 'flex', alignItems: 'center',
                }}
              >×</button>
            </span>
          ))}

          {/* Sheet filter chips */}
          {activePills.map(label => (
            <span key={label} style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
              background: 'rgba(232,160,32,0.1)', color: '#E8A020',
              border: '0.5px solid rgba(232,160,32,0.4)',
              borderRadius: 99, padding: '4px 10px', whiteSpace: 'nowrap',
            }}>
              {label}
              <button
                onClick={() => removePill(label)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#E8A020', padding: 0, fontSize: 13, lineHeight: 1,
                  opacity: 0.7, display: 'flex', alignItems: 'center',
                }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* ── RESULTS HEADER ── */}
      <div style={{ padding: '0 16px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 8,
          gap: 8,
        }}>
          <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
            <h1 style={{
              fontWeight: 300,
              fontSize: 'clamp(16px, 4vw, 22px)',
              letterSpacing: '-0.025em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {loading
                ? '…'
                : geoActive
                  ? `${displayed.length} homes within ${geoRadius} km${geoLabel ? ` of ${geoLabel}` : ''}`
                  : query.trim()
                    ? `${displayed.length} homes found in ${query.trim()}`
                    : isTopPicks
                      ? 'Top picks · Bangalore'
                      : `${displayed.length} homes found`}
            </h1>
            {!loading && !isTopPicks && (() => {
              const searched = query.trim().toLowerCase();
              const others = [...new Set(
                displayed
                  .map(l => l.location)
                  .filter(loc => loc && loc.toLowerCase() !== searched)
              )].slice(0, 4);
              if (others.length === 0) return null;
              return <NearbyDropdown localities={others} />;
            })()}
          </div>

          {/* View toggle */}
          <div style={{
            display: 'flex',
            gap: 2,
            background: 'var(--color-bg-surface)',
            borderRadius: 8,
            padding: 3,
          }}>
            {viewIcons.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                style={{
                  background: view === key ? 'var(--color-bg-card)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  color: view === key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  fontSize: 16,
                  transition: 'background 0.15s, color 0.15s',
                }}
                aria-label={`${key} view`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Source breakdown */}
        {!loading && Object.keys(allSourceCounts).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {Object.entries(allSourceCounts).map(([label, totalCount]) => {
              const rawSource = Object.keys(SOURCE_CONFIG).find(k => SOURCE_CONFIG[k].label === label);
              const cfg = (rawSource && SOURCE_CONFIG[rawSource]) || { color: '#666', icon: 'fa-solid fa-circle' };
              const active = rawSource ? activeFilters.sources[rawSource] !== false : true;
              const shownCount = sourceCounts[label] ?? 0;
              if (active && shownCount === 0) return null;
              return (
                <button
                  key={label}
                  onClick={() => rawSource && toggleSourceFilter(rawSource)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
                    border: `1px solid ${active ? cfg.color + '55' : 'var(--color-border)'}`,
                    background: active ? cfg.color + '11' : 'transparent',
                    color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    borderRadius: 20, padding: '4px 10px', cursor: 'pointer',
                    opacity: active ? 1 : 0.4,
                    transition: 'all 0.15s',
                  }}
                >
                  <i className={cfg.icon} style={{ fontSize: 10, color: active ? cfg.color : 'inherit' }} />
                  <span style={{ fontWeight: 500 }}>{active ? shownCount : totalCount}</span>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Sort bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            Sort by
          </span>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => setSort(opt)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.05em',
                background: sort === opt ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                color: sort === opt ? '#1a0a00' : 'var(--color-text-muted)',
                border: sort === opt ? 'none' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-pill)',
                padding: '6px 14px',
                cursor: 'pointer',
                transition: 'background 0.2s, color 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* ── RESULTS ── */}
      <div style={{ padding: '0 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : view === 'list' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {paginated.map(listing => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  saved={isSaved(listing.id) || savedIds.has(listing.id)}
                  onToggleSave={() => toggleSave(listing)}
                />
              ))}
            </div>
            {pageCount > 1 && <PaginationBar page={page} pageCount={pageCount} onPageChange={setPage} />}
          </>
        ) : view === 'grid' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {paginated.map(listing => (
                <GridCard
                  key={listing.id}
                  listing={listing}
                  saved={isSaved(listing.id) || savedIds.has(listing.id)}
                  onToggleSave={() => toggleSave(listing)}
                />
              ))}
            </div>
            {pageCount > 1 && <PaginationBar page={page} pageCount={pageCount} onPageChange={setPage} />}
          </>
        ) : (
          <SearchMapView listings={displayed} />
        )}
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <BottomNav />

      {/* ── FILTER BOTTOM SHEET ── */}
      <FilterBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        initialFilters={activeFilters}
        initialSort={sort}
        onApply={handleApply}
      />

        </>/* end mobile layout */
      )}{/* end isDesktop conditional */}

      {/* ── GEO RADIUS MODAL (shared: desktop + mobile) ── */}
      <GeoRadiusModal
        open={geoOpen}
        onClose={() => setGeoOpen(false)}
        currentPin={geoPin}
        currentRadius={geoRadius}
        currentLabel={geoLabel}
        onApply={(pin, radius, label) => {
          setGeoPin(pin);
          setGeoRadius(radius);
          setGeoLabel(label || '');
          setGeoActive(true);
          setQuery('');
          setActiveLocality(null);
          setPage(1);
          doSearch('');
        }}
        onClear={() => {
          setGeoActive(false);
          setGeoPin(null);
        }}
      />

      {/* ── SEARCH LOG TOAST ── */}
      <Toast
        toast={toast}
        onDismiss={dismissToast}
        onSignIn={signInWithGoogle}
      />
    </div>
  );
}
