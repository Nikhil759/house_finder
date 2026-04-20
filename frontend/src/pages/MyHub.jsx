import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useAuth } from '../hooks/useAuth';
import { useSavedListings } from '../hooks/useSavedListings';
import { useSavedSearches } from '../hooks/useSavedSearches';
import { useNewListings } from '../hooks/useNewListings';
import { useDesktop } from '../hooks/useDesktop';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── Static data ───────────────────────────────────────────────────────────────
const PIPELINE_STAGES = ['Saved', 'Interested', 'Contacted', 'Visited'];


const TIME_FILTERS = ['Last 24h', 'Last 3 days', 'Last 7 days'];

// ── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 80) return 'var(--color-amber)';
  if (score >= 60) return 'rgba(232,160,32,0.55)';
  return 'var(--color-text-muted)';
}

function timeAgo(ts) {
  if (!ts) return '';
  const ms = typeof ts === 'number' && ts < 1e12 ? ts * 1000 : Number(ts);
  const diff = Date.now() - (isNaN(ms) ? new Date(ts).getTime() : ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

const SOURCE_LABEL_MAP = {
  reddit:      'Reddit',
  telegram:    'Telegram',
  nobroker:    'NoBroker',
  housing:     'Housing.com',
  'housing.com': 'Housing.com',
};

function normalizeSource(raw) {
  return SOURCE_LABEL_MAP[(raw || '').toLowerCase()] || raw || 'Unknown';
}

function formatPriceStr(val) {
  const n = Number(val);
  if (!val || isNaN(n) || n === 0) return null;
  return `₹${n.toLocaleString('en-IN')}`;
}

const KNOWN_SOURCES = new Set(['reddit', 'nobroker', 'telegram', 'housing']);

function stableListingId(p) {
  const raw = (p.id || p.listing_id || '').toString();
  const src = (p.source || '').toLowerCase();
  const prefix = raw.split('_')[0];
  if (KNOWN_SOURCES.has(prefix)) return raw;
  if (raw.startsWith('nb_')) return `nobroker_${raw.slice(3)}`;
  if (src) return `${src}_${raw}`;
  return raw;
}

// Map a saved_listings row (with _status, _notes spread in) → card props
function normalizeRow(row) {
  const STAGE_MAP = { saved: 'Saved', interested: 'Interested', contacted: 'Contacted', visited: 'Visited' };
  return {
    id:        stableListingId(row),
    source:    normalizeSource(row.source),
    price:     formatPriceStr(row.price ?? row.rent) || 'Price on request',
    timeAgo:   timeAgo(row.created || row.created_utc),
    title:     row.title || '(no title)',
    bhk:       row.bhk || null,
    sqft:      row.area_sqft ? Number(row.area_sqft).toLocaleString('en-IN') : null,
    location:  row.locality || null,
    furnished: row.furnishing || null,
    stage:     STAGE_MAP[(row._status || 'saved').toLowerCase()] || 'Saved',
    note:      row._notes || '',
    phone:     row.contact_phone || null,
    url:       row.url || row.source_url || null,
    _raw:      row,
  };
}

// Map a /api/search/new listing → NewLeadCard props
function normalizeNewLead(listing) {
  return {
    id:      stableListingId(listing),
    source:  normalizeSource(listing.source),
    score:   Math.round(listing.quality_score || 0),
    title:   listing.title || '(no title)',
    bhk:     listing.bhk || null,
    sqft:    listing.area_sqft ? Number(listing.area_sqft).toLocaleString('en-IN') : null,
    location: listing.locality || null,
    price:   formatPriceStr(listing.price ?? listing.rent) || 'Price on request',
    timeAgo: timeAgo(listing.created || listing.created_utc),
    url:     listing.url || listing.source_url || null,
    _raw:    listing,
  };
}

// Convert UI time-filter label → ISO since string for useNewListings
function sinceForFilter(filter) {
  const day = 24 * 60 * 60 * 1000;
  if (filter === 'Last 24h')    return new Date(Date.now() - day).toISOString();
  if (filter === 'Last 3 days') return new Date(Date.now() - 3 * day).toISOString();
  if (filter === 'Last 7 days') return new Date(Date.now() - 7 * day).toISOString();
  return null;
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const s = {
  page: {
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    minHeight: '100vh',
    paddingBottom: 100,
  },
  card: {
    background: 'var(--color-bg-surface)',
    borderRadius: 'var(--radius-card)',
    padding: '16px 18px',
  },
  monoSmall: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.06em',
    color: 'var(--color-text-muted)',
  },
  stagePill: (active) => ({
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderRadius: 'var(--radius-pill)',
    padding: '5px 12px',
    cursor: 'pointer',
    border: active ? 'none' : '1px solid var(--color-border)',
    background: active ? 'var(--color-amber)' : 'var(--color-bg-surface)',
    color: active ? '#1a0a00' : 'var(--color-text-muted)',
    transition: 'background 0.2s, color 0.2s',
    whiteSpace: 'nowrap',
  }),
};

// ── Source colors & stage styles ─────────────────────────────────────────────
const SOURCE_COLORS = {
  Reddit:       '#F97316',
  NoBroker:     '#E63946',
  'Housing.com':'#7C3AED',
  Telegram:     '#38BDF8',
};

const STAGE_STYLE = {
  Saved:            { bg: 'rgba(100,100,100,0.12)', color: '#888888', border: 'rgba(100,100,100,0.25)' },
  Interested:       { bg: 'rgba(232,160,32,0.12)',  color: '#E8A020', border: 'rgba(232,160,32,0.3)'  },
  Contacted:        { bg: 'rgba(34,197,94,0.12)',   color: '#22C55E', border: 'rgba(34,197,94,0.3)'   },
  Visited:          { bg: 'rgba(59,130,246,0.12)',  color: '#3B82F6', border: 'rgba(59,130,246,0.3)'  },

};

const STAGE_OPTIONS = ['Saved', 'Interested', 'Contacted', 'Visited', 'Not interested'];

// ── Sub-components ────────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  const color = SOURCE_COLORS[source] || '#666';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: 'var(--font-mono)', fontSize: 10,
      letterSpacing: '0.1em', textTransform: 'uppercase', color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {source}
    </span>
  );
}

function PipelineTracker({ listings, activeStage }) {
  const stages    = ['Saved', 'Interested', 'Contacted', 'Visited'];
  const activeIdx = stages.indexOf(activeStage); // -1 when 'All'

  function dotStyle(i) {
    if (activeIdx < 0)   return { bg: '#252525', border: '#333' };
    if (i < activeIdx)   return { bg: 'rgba(34,197,94,0.35)', border: 'rgba(34,197,94,0.65)' };
    if (i === activeIdx) return { bg: 'var(--color-amber)', border: 'var(--color-amber)' };
    return { bg: '#111', border: '#2A2A2A' };
  }

  function textColor(i) {
    if (activeIdx < 0)   return '#3A3A3A';
    if (i < activeIdx)   return 'rgba(34,197,94,0.65)';
    if (i === activeIdx) return 'var(--color-amber)';
    return '#333';
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Dots + connecting line */}
      <div style={{ position: 'relative', display: 'flex', marginBottom: 7 }}>
        {/* Base line spans between first and last dot centers */}
        <div style={{
          position: 'absolute', left: '12.5%', right: '12.5%',
          height: 1, background: '#222', top: 5, zIndex: 0,
        }} />
        {/* Completed portion — width = activeIdx * 25% */}
        {activeIdx > 0 && (
          <div style={{
            position: 'absolute', left: '12.5%',
            width: `${activeIdx * 25}%`,
            height: 1, background: 'rgba(34,197,94,0.45)', top: 5, zIndex: 1,
          }} />
        )}
        {stages.map((st, i) => {
          const ds = dotStyle(i);
          return (
            <div key={st} style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: ds.bg, border: `1.5px solid ${ds.border}`, flexShrink: 0,
              }} />
            </div>
          );
        })}
      </div>

      {/* Labels + counts */}
      <div style={{ display: 'flex' }}>
        {stages.map((st, i) => {
          const count = listings.filter(l => l.stage === st).length;
          const tc = textColor(i);
          return (
            <div key={st} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: tc, textAlign: 'center',
              }}>
                {st}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: tc }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Ghost icon button base style (used in MyListingCard action row)
const ghostIconBtn = {
  background: 'none', border: '1px solid #2E2E2E', borderRadius: 6,
  width: 30, height: 30, cursor: 'pointer', padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--color-text-muted)', fontSize: 13,
  transition: 'border-color 0.15s, color 0.15s',
};

// Status pills shown in ROW 1 — 'Not interested' lives in the ··· overflow menu
const STATUS_PILLS = [
  { key: 'Interested', activeBg: '#E8A020', activeText: '#1A0A00' },
  { key: 'Contacted',  activeBg: '#22C55E', activeText: '#051A0A' },
  { key: 'Visited',    activeBg: '#3B82F6', activeText: '#020D1A' },
];

function StaleBadge({ listingStatus }) {
  if (!listingStatus || listingStatus === 'active') return null;
  const isExpired = listingStatus === 'expired';
  const color = isExpired ? '#ef4444' : '#f59e0b';
  const label = isExpired ? 'Expired' : 'No longer active';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: `${color}12`, border: `1px solid ${color}30`,
      borderRadius: 8, padding: '6px 12px', marginBottom: 10,
      fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', color,
    }}>
      <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 10 }} />
      {label} — this listing may no longer be available
    </div>
  );
}

function MyListingCard({ listing, onRemove, onStageChange, onNoteSave, listingStatus }) {
  const [stage, setStage]             = useState(listing.stage);
  const [noteText, setNoteText]       = useState(listing.note || '');
  const [noteEditing, setNoteEditing] = useState(false);

  const srcColor    = SOURCE_COLORS[listing.source] || '#666';
  const showWhatsApp = listing.source === 'Telegram' || (listing.source === 'Reddit' && listing.phone);
  const isStaleOrExpired = listingStatus === 'stale' || listingStatus === 'expired';

  function handleStageChange(newStage) {
    setStage(newStage);
    onStageChange?.(listing.id, newStage);
  }

  function handleNoteBlur() {
    setNoteEditing(false);
    onNoteSave?.(listing.id, noteText);
  }

  function handleCopyOutreach() {
    navigator.clipboard.writeText(
      `Hi, I'm interested in your listing: "${listing.title}" at ${listing.location}. Asking price: ${listing.price}. Please let me know if it's still available.`
    );
  }

  return (
    <article style={{
      background: '#111111',
      border: `1px solid ${isStaleOrExpired ? 'rgba(245,158,11,0.35)' : '#2E2E2E'}`,
      borderRadius: 8,
      padding: 16,
      marginBottom: 8,
      opacity: isStaleOrExpired ? 0.75 : 1,
      transition: 'opacity 0.2s',
    }}>

      <StaleBadge listingStatus={listingStatus} />

      {/* ── Top row: source dot · price / time ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          color: srcColor,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: srcColor, flexShrink: 0 }} />
          {listing.source}
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500,
            color: 'var(--color-amber)', letterSpacing: '-0.01em',
          }}>
            {listing.price}/mo
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--color-text-muted)', letterSpacing: '0.03em',
          }}>
            {listing.timeAgo}
          </span>
        </div>
      </div>

      {/* ── Title ── */}
      <h3 style={{
        fontWeight: 500, fontSize: 15, lineHeight: 1.4,
        letterSpacing: '-0.01em', color: 'var(--color-text-primary)',
        marginBottom: 10,
        display: '-webkit-box', WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {listing.title}
      </h3>

      {/* ── Tags row ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[listing.bhk, listing.sqft ? `${listing.sqft} sqft` : null, listing.furnished].filter(Boolean).map(spec => (
          <span key={spec} style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
            color: 'var(--color-text-muted)', background: '#111111',
            border: '1px solid #2E2E2E', borderRadius: 6, padding: '3px 8px',
          }}>
            {spec}
          </span>
        ))}
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--color-text-muted)', letterSpacing: '0.03em',
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <i className="fa-solid fa-location-dot" style={{ fontSize: 10 }} />
          {listing.location}
        </span>
      </div>

      {/* ════ DIVIDER — everything below is the redesigned bottom section ════ */}
      <div style={{ borderTop: '1px solid #2A2A2A', paddingTop: 10 }}>

        {/* ── Note preview / inline editor ── */}
        {noteEditing ? (
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onBlur={handleNoteBlur}
            autoFocus
            placeholder="Add a note…"
            style={{
              width: '100%', minHeight: 64, marginBottom: 10,
              background: '#0D0D0D', border: '1px solid #2E2E2E', borderRadius: 6,
              padding: '8px 10px', color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.6,
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
            }}
          />
        ) : (
          <p
            onClick={() => setNoteEditing(true)}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 12, fontStyle: 'italic',
              color: noteText ? 'var(--color-text-muted)' : '#3A3A3A',
              cursor: 'text', lineHeight: 1.5, margin: '0 0 10px',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}
          >
            {noteText ? noteText.split('\n')[0] : 'Add a note…'}
          </p>
        )}

        {/* ── ROW 1 — Status pills + ··· overflow ── */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          {STATUS_PILLS.map(({ key, activeBg, activeText }) => {
            const isActive = stage === key;
            return (
              <button
                key={key}
                onClick={() => handleStageChange(key)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                  textTransform: 'uppercase', borderRadius: 99,
                  padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: isActive ? activeBg : '#0D0D0D',
                  color: isActive ? activeText : '#666',
                  border: isActive ? 'none' : '1px solid #2E2E2E',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {key}
              </button>
            );
          })}

        </div>

        {/* ── ROW 2 — ghost actions + Open ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {showWhatsApp && (
            <button
              onClick={() => window.open(`https://wa.me/${listing.phone || ''}`)}
              title="WhatsApp"
              style={{ ...ghostIconBtn, width: 30, height: 30, color: '#22C55E', borderColor: 'rgba(34,197,94,0.3)' }}
            >
              <i className="fa-brands fa-whatsapp" style={{ fontSize: 14 }} />
            </button>
          )}

          <button
            onClick={handleCopyOutreach}
            style={{
              background: 'none', border: '1px solid #2E2E2E', borderRadius: 6,
              height: 30, padding: '0 10px', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
              color: 'var(--color-text-muted)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            Copy outreach
          </button>

          <button
            onClick={() => onRemove?.(listing.id)}
            title="Remove listing"
            style={{ ...ghostIconBtn, width: 30, height: 30 }}
            onMouseEnter={e => { e.currentTarget.style.color = '#E8394D'; e.currentTarget.style.borderColor = 'rgba(232,57,77,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = '#2A2A2A'; }}
          >
            <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
          </button>

          <Link
            to={`/listing/${listing.id}`}
            state={{ listing: listing._raw }}
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
              letterSpacing: '0.06em',
              color: 'var(--color-amber)',
              border: '1px solid rgba(232,160,32,0.3)',
              background: 'rgba(232,160,32,0.05)',
              borderRadius: 6, padding: '0 14px', height: 34,
              display: 'inline-flex', alignItems: 'center',
              textDecoration: 'none', transition: 'border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber)'; e.currentTarget.style.background = 'rgba(232,160,32,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(232,160,32,0.3)'; e.currentTarget.style.background = 'rgba(232,160,32,0.05)'; }}
          >
            Details
          </Link>
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
                letterSpacing: '0.06em',
                color: 'var(--color-amber)',
                border: '1px solid rgba(232,160,32,0.3)',
                background: 'rgba(232,160,32,0.05)',
                borderRadius: 6, padding: '0 14px', height: 34,
                textDecoration: 'none', transition: 'border-color 0.2s, background 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber)'; e.currentTarget.style.background = 'rgba(232,160,32,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(232,160,32,0.3)'; e.currentTarget.style.background = 'rgba(232,160,32,0.05)'; }}
            >
              <i className="fa-solid fa-arrow-up-right-from-square" style={{ fontSize: 12 }} />
              Source
            </a>
          )}
        </div>

      </div>
    </article>
  );
}

function NewLeadCard({ listing, onSave, onHide, isSavedFn }) {
  const [saving, setSaving] = useState(false);
  const [popped, setPopped] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    if (!alreadySaved) {
      setPopped(true);
      setTimeout(() => setPopped(false), 400);
    }
    await onSave?.(listing._raw || listing);
    setSaving(false);
  }

  const alreadySaved = isSavedFn?.(listing.id);

  return (
    <Link
      to={`/listing/${listing.id}`}
      state={{ listing: listing._raw }}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <article
        style={{ ...s.card, marginBottom: 8, cursor: 'pointer', transition: 'background 0.15s' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-card)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = s.card.background; }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SourceBadge source={listing.source} />
            <span style={{ ...s.monoSmall }}>{listing.timeAgo}</span>
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
            border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 10px',
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
              color: scoreColor(listing.score), letterSpacing: '-0.03em', lineHeight: 1,
            }}>
              {listing.score}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
              IQ SCORE
            </span>
          </div>
        </div>

        <h3 style={{ fontWeight: 300, fontSize: 15, lineHeight: 1.4, marginBottom: 10 }}>
          {listing.title}
        </h3>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {[listing.bhk, listing.sqft ? `${listing.sqft} sqft` : null, listing.location].filter(Boolean).map(spec => (
            <span key={spec} style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
              color: 'var(--color-text-muted)', background: 'var(--color-bg-card)',
              borderRadius: 4, padding: '3px 8px',
            }}>
              {spec}
            </span>
          ))}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
            color: 'var(--color-text-primary)', marginLeft: 'auto',
          }}>
            {listing.price}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); handleSave(); }}
            disabled={saving}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
              background: 'none',
              border: `1px solid ${alreadySaved ? '#E8394D' : 'var(--color-border)'}`,
              color: alreadySaved ? '#E8394D' : 'var(--color-text-muted)',
              borderRadius: 6, padding: '7px 14px', cursor: saving ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'border-color 0.2s, color 0.2s',
              opacity: saving ? 0.6 : 1,
            }}
          >
            <i
              className={alreadySaved ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}
              style={{ animation: popped ? 'heartPop 0.35s ease' : 'none' }}
            />
            {alreadySaved ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onHide?.(listing.id); }}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
              background: 'none', border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)', borderRadius: 6,
              padding: '7px 14px', cursor: 'pointer',
              transition: 'border-color 0.2s, color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-text-muted)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
          >
            ✕ Hide
          </button>
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
                letterSpacing: '0.06em',
                color: 'var(--color-amber)',
                border: '1px solid rgba(232,160,32,0.3)',
                background: 'rgba(232,160,32,0.05)',
                borderRadius: 6, padding: '0 14px', height: 34,
                textDecoration: 'none',
                transition: 'border-color 0.2s, background 0.2s',
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


// ── Main page ─────────────────────────────────────────────────────────────────
export default function MyHub() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const isDesktop = useDesktop();

  // ── Real data hooks ───────────────────────────────────────────────────────
  const {
    savedListings,
    loading: savedLoading,
    isSaved,
    saveListing,
    updateStatus,
    updateNotes,
  } = useSavedListings(user);

  const { savedSearches } = useSavedSearches(user);

  const [mainTab, setMainTab]         = useState('Saved Leads');
  const [stageFilter, setStageFilter] = useState('All');
  const [timeFilter, setTimeFilter]   = useState('Last 24h');
  const [hiddenLeads, setHiddenLeads] = useState(new Set());
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const LEADS_PER_GROUP = 5;

  // Must be memoized — a bare sinceForFilter() call produces a new Date string
  // every render, which re-triggers useNewListings's useEffect endlessly.
  const sinceOverride = useMemo(() => sinceForFilter(timeFilter), [timeFilter]);

  const {
    newListings,
    totalCount: totalNewLeads,
    loading: leadsLoading,
    markAllSeen,
  } = useNewListings(user, savedSearches, sinceOverride);

  // ── Fetch listing statuses for stale/expired detection ─────────────────
  const [listingStatuses, setListingStatuses] = useState({});

  useEffect(() => {
    if (!savedListings.length) return;
    const ids = savedListings.map(l => stableListingId(l));
    if (!ids.length) return;
    fetch(`${API_BASE}/api/listing-statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then(r => r.json())
      .then(data => { if (data && !data.error) setListingStatuses(data); })
      .catch(() => {});
  }, [savedListings]);

  // ── Derived data ──────────────────────────────────────────────────────────
  // Normalize saved listings for card display
  const normalizedListings = useMemo(
    () => savedListings.map(normalizeRow),
    [savedListings]
  );

  const filteredListings = stageFilter === 'All'
    ? normalizedListings
    : normalizedListings.filter(l => l.stage === stageFilter);


  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleStageChange(id, newStage) {
    updateStatus(id, newStage.toLowerCase()); // optimistic via hook
  }

  function handleRemove(id) {
    const raw = savedListings.find(p => String(p.id) === String(id));
    if (raw) saveListing(raw); // toggles unsave → deletes from Supabase
  }

  function handleNoteSave(id, notes) {
    updateNotes(id, notes);
  }

  function handleHideLead(id) {
    setHiddenLeads(prev => new Set([...prev, String(id)]));
  }

  async function handleSaveLead(listing) {
    await saveListing(listing._raw || listing);
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  function SkeletonCard() {
    return (
      <div style={{
        background: '#111111', border: '1px solid #2E2E2E', borderRadius: 8,
        padding: 16, marginBottom: 8,
      }}>
        {[80, 120, 60].map(w => (
          <div key={w} style={{
            height: 12, width: `${w}%`, borderRadius: 6,
            background: '#252525', marginBottom: 10,
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
        ))}
      </div>
    );
  }

  // ── Gate: not signed in ──────────────────────────────────────────────────
  if (!authLoading && !user) {
    const features = [
      { icon: 'fa-solid fa-bookmark',       label: 'Save listings you like' },
      { icon: 'fa-solid fa-bolt',           label: 'Get auto leads for your areas' },
      { icon: 'fa-solid fa-chart-simple',   label: 'Track your search progress' },
    ];
    return (
      <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0 }}>
        <DesktopSidebar />
        <AppHeader />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 136px)',
          padding: '0 32px',
          textAlign: 'center',
        }}>
          {/* NestIQ target icon */}
          <img
            src="/icon.svg"
            alt="NestIQ"
            style={{ width: 40, height: 40, marginBottom: 24 }}
          />

          <h1 style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 300,
            fontSize: 24,
            letterSpacing: '-0.025em',
            color: 'var(--color-text-primary)',
            marginBottom: 10,
          }}>
            Sign in to access My Hub
          </h1>

          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            color: 'var(--color-text-muted)',
            lineHeight: 1.55,
            marginBottom: 28,
            maxWidth: 260,
          }}>
            Save listings, track your search, and get auto leads
          </p>

          {/* Feature hints */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 32,
          }}>
            {features.map(({ icon, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className={icon} style={{ fontSize: 12, color: 'var(--color-amber)', width: 14, textAlign: 'center', flexShrink: 0 }} />
                <span style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  color: 'var(--color-text-muted)',
                }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Sign-in button */}
          <button
            onClick={signInWithGoogle}
            style={{
              width: '100%',
              maxWidth: 280,
              height: 48,
              background: 'var(--color-amber)',
              color: '#1a0a00',
              border: 'none',
              borderRadius: 12,
              fontFamily: 'var(--font-sans)',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              letterSpacing: '-0.01em',
              marginBottom: 12,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.04em',
          }}>
            Free · No credit card required
          </span>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, paddingBottom: isDesktop ? 40 : 100 }}>
      <DesktopSidebar />

      <AppHeader />

      {/* ── STICKY TAB BAR ── */}
      <div style={{
        position: 'sticky', top: isDesktop ? 0 : 56, zIndex: 50,
        background: 'rgba(10,10,10,0.92)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 16px',
      }}>
        <div style={{
          display: 'flex', gap: 2,
          background: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-card)', padding: 3,
        }}>
          {['Saved Leads', 'New Leads'].map(tab => (
            <button
              key={tab}
              onClick={() => setMainTab(tab)}
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.04em',
                background: mainTab === tab ? 'var(--color-bg-card)' : 'transparent',
                color: mainTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                border: 'none', borderRadius: 9, padding: '8px 0',
                cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
                position: 'relative',
              }}
            >
              {tab}
              {tab === 'New Leads' && totalNewLeads > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 12,
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  background: 'var(--color-amber)', color: '#1a0a00',
                  borderRadius: 'var(--radius-pill)', padding: '1px 5px',
                  letterSpacing: '0.04em',
                }}>
                  {totalNewLeads}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        padding: isDesktop ? '20px 24px 0' : '20px 16px 0',
        maxWidth: isDesktop ? 1440 : undefined,
        margin: isDesktop ? '0 auto' : undefined,
      }}>

        {/* ════════════════════════════════ MY LISTINGS ═══════════════════════════ */}
        {mainTab === 'Saved Leads' && (
          <div style={isDesktop ? { display: 'flex', gap: 32, alignItems: 'flex-start' } : {}}>

            {/* ── LEFT: pipeline + stage filters ── */}
            <div style={isDesktop ? {
              width: 360, flexShrink: 0,
              position: 'sticky', top: 52,
              background: 'var(--color-bg-primary)',
              paddingBottom: 16,
            } : {}}>
              {/* Summary row */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
                <h1 style={{ fontWeight: 300, fontSize: 22, letterSpacing: '-0.025em' }}>
                  {savedListings.length} saved
                </h1>
                <span style={{ ...s.monoSmall }}>across {PIPELINE_STAGES.length} stages</span>
              </div>

              {/* Pipeline progress tracker */}
              <PipelineTracker listings={normalizedListings} activeStage={stageFilter} />

              {/* Stage filter chips */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', scrollbarWidth: 'none' }}>
                <button onClick={() => setStageFilter('All')} style={s.stagePill(stageFilter === 'All')}>
                  All
                </button>
                {PIPELINE_STAGES.map(stage => {
                  const count = normalizedListings.filter(l => l.stage === stage).length;
                  return (
                    <button
                      key={stage}
                      onClick={() => setStageFilter(stage)}
                      style={s.stagePill(stageFilter === stage)}
                    >
                      {stage}
                      {count > 0 && (
                        <span style={{
                          marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 9,
                          opacity: stageFilter === stage ? 0.7 : 0.5,
                        }}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── RIGHT: listing cards ── */}
            <div style={isDesktop ? { flex: 1, minWidth: 0 } : {}}>
              {savedLoading ? (
                [1, 2, 3].map(i => <SkeletonCard key={i} />)
              ) : filteredListings.length === 0 ? (
                <div style={{
                  textAlign: 'center', padding: '48px 24px',
                  background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)',
                }}>
                  <p style={{ ...s.monoSmall, fontSize: 13 }}>
                    {stageFilter === 'All' ? 'No saved leads yet.' : `No leads in ${stageFilter} stage.`}
                  </p>
                  <Link to="/search" style={{
                    display: 'inline-block', marginTop: 16,
                    fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
                    color: 'var(--color-amber)', textDecoration: 'none',
                  }}>
                    Search listings →
                  </Link>
                </div>
              ) : (
                filteredListings.map(listing => (
                  <MyListingCard
                    key={listing.id}
                    listing={listing}
                    listingStatus={listingStatuses[listing.id]}
                    onRemove={handleRemove}
                    onStageChange={handleStageChange}
                    onNoteSave={handleNoteSave}
                  />
                ))
              )}
            </div>

          </div>
        )}

        {/* ════════════════════════════════ NEW LEADS ═════════════════════════════ */}
        {mainTab === 'New Leads' && (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
              <h1 style={{ fontWeight: 300, fontSize: 22, letterSpacing: '-0.025em' }}>
                {totalNewLeads} listings
              </h1>
              <button
                onClick={markAllSeen}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                  textTransform: 'uppercase', background: 'none',
                  border: '1px solid var(--color-border)', borderRadius: 6,
                  padding: '5px 12px', cursor: 'pointer', color: 'var(--color-text-muted)',
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
                Mark all seen
              </button>
            </div>

            {/* Time filter */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 24, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {TIME_FILTERS.map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeFilter(tf)}
                  style={s.stagePill(timeFilter === tf)}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Loading state */}
            {leadsLoading && Object.keys(newListings).length === 0 && (
              [1, 2].map(i => <SkeletonCard key={i} />)
            )}

            {/* Lead groups — rendered directly from hook output, same as NewForYou.jsx */}
            {Object.values(newListings).map(({ search, listings }) => {
              const visible = listings.filter(l => !hiddenLeads.has(l.id));
              if (visible.length === 0) return null;
              const isExpanded = expandedGroups.has(search.id);
              const shown = isExpanded ? visible : visible.slice(0, LEADS_PER_GROUP);
              const remaining = visible.length - LEADS_PER_GROUP;
              return (
                <section key={search.id} style={{ marginBottom: 32 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', marginBottom: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h2 style={{ fontWeight: 300, fontSize: 18, letterSpacing: '-0.02em' }}>
                        {search.location || search.name || 'Saved Search'}
                        {search.bhk && (
                          <>
                            <span style={{ color: 'var(--color-text-muted)', margin: '0 6px', fontWeight: 300 }}>·</span>
                            {search.bhk}
                          </>
                        )}
                      </h2>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
                        background: 'var(--color-amber)', color: '#1a0a00',
                        borderRadius: 'var(--radius-pill)', padding: '2px 8px', fontWeight: 500,
                      }}>
                        {visible.length} NEW
                      </span>
                    </div>
                  </div>

                  {shown.map(listing => (
                    <NewLeadCard
                      key={listing.id}
                      listing={normalizeNewLead(listing)}
                      onSave={handleSaveLead}
                      onHide={handleHideLead}
                      isSavedFn={isSaved}
                    />
                  ))}

                  {!isExpanded && remaining > 0 && (
                    <button
                      onClick={() => setExpandedGroups(prev => new Set([...prev, search.id]))}
                      style={{
                        width: '100%',
                        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                        background: 'none', border: '1px solid var(--color-border)',
                        color: 'var(--color-text-muted)', borderRadius: 8,
                        padding: '10px', cursor: 'pointer', marginTop: 4,
                        transition: 'border-color 0.2s, color 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                    >
                      Show {remaining} more →
                    </button>
                  )}
                  {isExpanded && visible.length > LEADS_PER_GROUP && (
                    <button
                      onClick={() => setExpandedGroups(prev => { const next = new Set(prev); next.delete(search.id); return next; })}
                      style={{
                        width: '100%',
                        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                        background: 'none', border: '1px solid var(--color-border)',
                        color: 'var(--color-text-muted)', borderRadius: 8,
                        padding: '10px', cursor: 'pointer', marginTop: 4,
                        transition: 'border-color 0.2s, color 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-text-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                    >
                      Show less ↑
                    </button>
                  )}
                </section>
              );
            })}

            {/* Empty state */}
            {!leadsLoading && Object.keys(newListings).length === 0 && (
              <div style={{
                textAlign: 'center', padding: '32px 24px',
                background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)',
              }}>
                <p style={{ ...s.monoSmall, marginBottom: 4 }}>
                  {savedSearches.length === 0
                    ? 'Save a search to get new lead alerts here.'
                    : 'No new listings in this timeframe.'}
                </p>
                <Link to="/search" style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
                  color: 'var(--color-amber)', textDecoration: 'none',
                }}>
                  Go to Search →
                </Link>
              </div>
            )}
          </>
        )}

      </div>

      <BottomNav />
    </div>
  );
}
