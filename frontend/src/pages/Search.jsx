import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faLaptopCode, faBuilding, faTree, faBeerMugEmpty,
  faHammer, faWater, faHouse, faBolt,
} from '@fortawesome/free-solid-svg-icons';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';

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
  { key: 'high_score', label: 'High score 80+',      category: 'quality'   },
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
  if (score >= 80) return '#E8A020';             // full amber
  if (score >= 60) return 'rgba(232,160,32,0.5)'; // dim amber
  return '#555555';                               // muted gray
}

function normalizePost(p) {
  const cfg = SOURCE_CONFIG[p.source] || { label: p.source, color: '#666', icon: 'fa-solid fa-circle' };
  return {
    id:          p.id,
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
    url:         p.url || p.source_url || null,
    rawCreated:  p.created || p.created_utc || 0,
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

  function handleSaveClick() {
    onToggleSave();
    if (!saved) {
      setPopped(true);
      setTimeout(() => setPopped(false), 350);
    }
  }

  return (
    <article style={{
      background: 'var(--color-bg-surface)',
      borderRadius: 'var(--radius-card)',
      padding: '18px 20px',
    }}>
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
        {listing.url ? (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '0.04em',
              background: 'var(--color-amber)',
              color: '#1a0a00',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              cursor: 'pointer',
              fontWeight: 500,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Open →
          </a>
        ) : (
          <button style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.04em',
            background: 'var(--color-amber)',
            color: '#1a0a00',
            border: 'none',
            borderRadius: 6,
            padding: '8px 18px',
            cursor: 'pointer',
            fontWeight: 500,
          }}>
            Open →
          </button>
        )}
      </div>
    </article>
  );
}

function GridCard({ listing, saved, onToggleSave }) {
  const [popped, setPopped] = useState(false);

  function handleSaveClick() {
    onToggleSave();
    if (!saved) {
      setPopped(true);
      setTimeout(() => setPopped(false), 350);
    }
  }

  return (
    <article style={{
      background: 'var(--color-bg-surface)',
      borderRadius: 'var(--radius-card)',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
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
  );
}

function MapPlaceholder() {
  return (
    <div style={{
      flex: 1,
      background: 'var(--color-bg-surface)',
      borderRadius: 'var(--radius-card)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      minHeight: 340,
      border: '1px solid var(--color-border)',
    }}>
      <span style={{ fontSize: 32 }}>🗺</span>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        Map view — coming soon
      </p>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        {[
          { label: '80+',   color: 'var(--color-amber)' },
          { label: '60–79', color: 'rgba(232,160,32,0.5)' },
          { label: '<60',   color: 'var(--color-text-muted)' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
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
  const [searchParams]  = useSearchParams();
  const [query, setQuery]             = useState(searchParams.get('q') || '');
  const [view, setView]               = useState('list');
  const [sort, setSort]               = useState('Score');
  const [activeFilters, setActiveFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    sources: { ...DEFAULT_FILTERS.sources },
  }));
  const [sheetOpen, setSheetOpen]     = useState(false);
  const [activeLocality, setActiveLocality] = useState(null);
  const [quickFilters, setQuickFilters]     = useState(new Set());
  const [areaSuggestions, setAreaSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const areaInputRef  = useRef(null);
  const wasLoadingRef = useRef(false);
  const [progressState, setProgressState] = useState('idle'); // 'idle' | 'running' | 'completing'
  const [listings, setListings]       = useState([]);
  const [total, setTotal]             = useState(0);
  const [sourceCounts, setSourceCounts] = useState({});
  const [loading, setLoading]         = useState(false);
  const [savedIds, setSavedIds]       = useState(new Set());

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const doSearch = useCallback(async (area) => {
    setLoading(true);
    const params = new URLSearchParams({
      sources:   'reddit,telegram,nobroker,housing',
      sort:      'score',
      min_score: 20,
      limit:     50,
      ...(area ? { area } : {}),
    });
    try {
      const res  = await fetch(`/api/search?${params}`);
      const data = await res.json();
      const posts = (data.posts || []).map(normalizePost);
      setListings(posts);
      setTotal(data.total ?? posts.length);
      const counts = {};
      (data.posts || []).forEach(p => {
        const label = SOURCE_LABELS[p.source] || p.source;
        counts[label] = (counts[label] || 0) + 1;
      });
      setSourceCounts(counts);
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    doSearch(searchParams.get('q') || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  function toggleSave(id) {
    setSavedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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
  Object.entries(SOURCE_CONFIG).forEach(([key, cfg]) => {
    if (!activeFilters.sources[key]) activePills.push(`No ${cfg.label}`);
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
        if (key === 'high_score')return listing.score >= 80;
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
    return true;
  });

  const viewIcons = [
    { key: 'list', label: '≡' },
    { key: 'grid', label: '⊞' },
    { key: 'map',  label: '⊙' },
  ];

  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-sans)',
      minHeight: '100vh',
      paddingBottom: 80,
    }}>
      <AppHeader />

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
        <div style={{ position: 'relative' }}>
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
              type="search"
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
                    doSearch(chosen);
                  } else if (e.key === 'Escape') {
                    setShowSuggestions(false);
                  } else if (e.key === 'Enter') {
                    setShowSuggestions(false);
                    doSearch(query);
                  }
                } else if (e.key === 'Enter') {
                  doSearch(query);
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
            <button
              onClick={() => setSheetOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                borderRadius: 8,
                padding: '6px 8px',
                cursor: 'pointer',
                color: activePills.length > 0 ? 'var(--color-amber)' : 'var(--color-text-muted)',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
              }}
              aria-label="Open filters"
            >
              <i className="fa-solid fa-sliders" />
            </button>
            <button
              onClick={() => { setShowSuggestions(false); doSearch(query); }}
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

          {/* Autocomplete dropdown */}
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
                    doSearch(s);
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
        </div>

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
                  doSearch(label);
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
      <div style={{
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 0,
        display: 'flex',
        gap: 8,
        marginBottom: 12,
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
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-amber)',
              display: 'inline-block',
              flexShrink: 0,
            }} />
          )}
          {' '}▼
        </button>

        {/* Quick toggle pills */}
        {QUICK_FILTERS.map(({ key, label }) => {
          const active = quickFilters.has(key);
          return (
            <button
              key={key}
              onClick={() => {
                setQuickFilters(prev => {
                  const next = new Set(prev);
                  next.has(key) ? next.delete(key) : next.add(key);
                  return next;
                });
              }}
              style={{
                flexShrink: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.05em',
                background: active ? '#E8A020' : '#1A1A1A',
                color: active ? '#0A0A0A' : '#888',
                border: '0.5px solid #2A2A2A',
                borderRadius: 99,
                padding: '5px 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {label}
            </button>
          );
        })}

        {/* Active sheet filter pills — dismissible */}
        {activePills.map(label => (
          <FilterPill
            key={label}
            label={label}
            onRemove={() => removePill(label)}
            onOpenSheet={() => setSheetOpen(true)}
          />
        ))}
      </div>

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
                : query.trim()
                  ? `${displayed.length} homes found in ${query.trim()}`
                  : `${displayed.length} homes found`}
            </h1>
            {!loading && (() => {
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
        {!loading && Object.keys(sourceCounts).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 14 }}>
            {Object.entries(sourceCounts).map(([label, count]) => {
              const cfg = Object.values(SOURCE_CONFIG).find(c => c.label === label)
                       || { color: '#666', icon: 'fa-solid fa-circle' };
              return (
                <span key={label} style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  color: 'var(--color-text-muted)',
                }}>
                  <i className={cfg.icon} style={{ fontSize: 10, color: cfg.color }} />
                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{count}</span>
                  <span>{label}</span>
                </span>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayed.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                saved={savedIds.has(listing.id)}
                onToggleSave={() => toggleSave(listing.id)}
              />
            ))}
          </div>
        ) : view === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {displayed.map(listing => (
              <GridCard
                key={listing.id}
                listing={listing}
                saved={savedIds.has(listing.id)}
                onToggleSave={() => toggleSave(listing.id)}
              />
            ))}
          </div>
        ) : (
          <MapPlaceholder />
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
    </div>
  );
}
