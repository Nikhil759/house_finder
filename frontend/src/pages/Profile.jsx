import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useAuth } from '../hooks/useAuth';
import { useSavedSearches } from '../hooks/useSavedSearches';
import { useDesktop } from '../hooks/useDesktop';
import { posthog } from '../lib/posthog';

const API_BASE = import.meta.env.VITE_API_URL || '';

const FREQUENCIES = [
  { value: 'daily', label: 'Everyday' },
  { value: 'every_3_days', label: '3 days' },
  { value: 'every_5_days', label: '5 days' },
  { value: 'weekly', label: 'Weekly' },
];

function formatSavedOn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatBudget(budget) {
  if (!budget) return null;
  const n = Number(budget);
  if (isNaN(n) || n === 0) return null;
  return `under ₹${(n / 1000).toFixed(0)}k`;
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
  section: {
    marginBottom: 32,
  },
  sectionLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    marginBottom: 12,
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
  divider: {
    height: 1,
    background: 'var(--color-border)',
    margin: '0 -18px',
  },
};


function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 13, padding: 3,
        background: checked ? 'var(--color-amber)' : 'var(--color-border)',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.2s', position: 'relative',
        flexShrink: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        display: 'block', width: 20, height: 20, borderRadius: '50%',
        background: '#fff',
        transform: checked ? 'translateX(18px)' : 'translateX(0)',
        transition: 'transform 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

function FrequencySelector({ value, onChange, disabled }) {
  return (
    <div style={{
      display: 'flex', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--color-border)',
      opacity: disabled ? 0.4 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
    }}>
      {FREQUENCIES.map((f, i) => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          style={{
            flex: 1, padding: '9px 0',
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
            background: value === f.value ? 'var(--color-amber)' : 'transparent',
            color: value === f.value ? '#1a0a00' : 'var(--color-text-muted)',
            fontWeight: value === f.value ? 600 : 400,
            border: 'none', cursor: 'pointer',
            borderLeft: i > 0 ? '1px solid var(--color-border)' : 'none',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function SimpleToast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 88, left: 16, right: 16,
        maxWidth: 440, margin: '0 auto', zIndex: 1000,
        background: '#161616',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 14, padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px rgba(0,0,0,0.55)',
        animation: 'toast-slide-up 0.22s ease',
      }}
    >
      <style>{`
        @keyframes toast-slide-up {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
      <span style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'rgba(232,160,32,0.14)',
        border: '1px solid rgba(232,160,32,0.28)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-amber)', fontSize: 11, flexShrink: 0,
      }}>
        <i className="fa-solid fa-check" />
      </span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
        {message}
      </span>
    </div>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function Profile() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { savedSearches, deleteSearch, saveSearch } = useSavedSearches(user);
  const isDesktop = useDesktop();

  const [emailPrefs, setEmailPrefs] = useState(null);
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [toast, setToast] = useState(null);

  // Locality picker state
  const [addingLocalities, setAddingLocalities] = useState(false);
  const [allLocalities, setAllLocalities] = useState([]);
  const [selectedNewLocs, setSelectedNewLocs] = useState(new Set());
  const [locFilter, setLocFilter] = useState('');

  // Load email preferences
  useEffect(() => {
    if (!user) { setEmailPrefsLoading(false); return; }
    setEmailPrefsLoading(true);
    fetch(`${API_BASE}/api/email/preferences?user_id=${user.id}`)
      .then(r => r.json())
      .then(data => {
        setEmailPrefs({
          subscribed: data.new_listings_email_subscribed ?? false,
          frequency: data.new_listings_frequency ?? 'daily',
          allUnsubscribed: data.all_emails_unsubscribed ?? false,
          disabledLocalities: data.disabled_localities ?? [],
        });
      })
      .catch(() => {})
      .finally(() => setEmailPrefsLoading(false));
  }, [user]);

  const saveEmailPrefs = useCallback(async (patch) => {
    if (!user || savingPrefs) return;
    setSavingPrefs(true);
    try {
      const res = await fetch(`${API_BASE}/api/email/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, ...patch }),
      });
      if (res.ok) {
        const out = {};
        if (patch.new_listings_email_subscribed !== undefined) out.subscribed = patch.new_listings_email_subscribed;
        if (patch.new_listings_frequency) out.frequency = patch.new_listings_frequency;
        if (patch.all_emails_unsubscribed !== undefined) out.allUnsubscribed = patch.all_emails_unsubscribed;
        if (patch.disabled_localities !== undefined) out.disabledLocalities = patch.disabled_localities;
        setEmailPrefs(prev => ({ ...prev, ...out }));
        setToast('Preferences saved');
      }
    } catch { /* ignore */ }
    finally { setSavingPrefs(false); }
  }, [user, savingPrefs]);

  function removeSearch(id) {
    deleteSearch(id);
  }

  function openLocalityPicker() {
    setAddingLocalities(true);
    setSelectedNewLocs(new Set());
    setLocFilter('');
    if (allLocalities.length === 0) {
      fetch(`${API_BASE}/api/localities`)
        .then(r => r.json())
        .then(data => setAllLocalities(data.names || []))
        .catch(() => {});
    }
  }

  async function addSelectedLocalities() {
    for (const loc of selectedNewLocs) {
      await saveSearch({ location: loc });
    }
    setAddingLocalities(false);
    setSelectedNewLocs(new Set());
  }

  if (loading) return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0 }}>
      <DesktopSidebar />
      <AppHeader />
    </div>
  );

  if (!user) return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0 }}>
      <DesktopSidebar />
      <AppHeader />
      <div style={{ padding: '48px 16px', textAlign: 'center' }}>
        <p style={{ ...s.monoSmall, marginBottom: 16 }}>Sign in to view your profile.</p>
        <Link to="/app" style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--color-amber)', textDecoration: 'none',
        }}>
          ← Go to Search
        </Link>
      </div>
    </div>
  );

  const displayName   = user.user_metadata?.full_name || user.email || 'User';
  const displayEmail  = user.email || '';
  const avatarUrl     = user.user_metadata?.avatar_url || null;
  const initials      = displayName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div style={{ ...s.page, marginLeft: isDesktop ? 240 : 0, paddingBottom: isDesktop ? 40 : 100 }}>
      <DesktopSidebar />

      <AppHeader />

      <div style={{
        padding: '24px 16px 0',
        maxWidth: isDesktop ? 600 : undefined,
        margin: isDesktop ? '0 auto' : undefined,
      }}>

        {/* ── USER CARD ── */}
        <section style={s.section}>
          <div style={{
            ...s.card,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}>
            {/* Avatar */}
            {avatarUrl ? (
              <div style={{
                width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                border: '1px solid var(--color-border)',
                overflow: 'hidden',
              }}>
                <img
                  src={avatarUrl}
                  alt={displayName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
            ) : (
              <div style={{
                width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500,
                  color: 'var(--color-amber)', letterSpacing: '0.05em',
                }}>
                  {initials}
                </span>
              </div>
            )}

            {/* Name + email */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 300, fontSize: 18, letterSpacing: '-0.01em', marginBottom: 3 }}>
                {displayName}
              </p>
              <p style={{ ...s.monoSmall, fontSize: 12 }}>
                {displayEmail}
              </p>
            </div>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
                textTransform: 'uppercase', background: 'none',
                border: '1px solid var(--color-border)', borderRadius: 6,
                padding: '7px 12px', cursor: 'pointer', color: 'var(--color-text-muted)',
                flexShrink: 0, transition: 'border-color 0.2s, color 0.2s',
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
              Sign out
            </button>
          </div>
        </section>

        {/* ── EMAIL PREFERENCES ── */}
        <section style={s.section}>
          <p style={s.sectionLabel}>Email Preferences</p>
          {emailPrefsLoading || !emailPrefs ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 24 }}>
              <p style={s.monoSmall}>Loading...</p>
            </div>
          ) : (
            <div style={s.card}>
              {/* Toggle row */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: emailPrefs.subscribed ? 16 : 0,
              }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 400, marginBottom: 3 }}>New listings digest</p>
                  <p style={{ ...s.monoSmall, fontSize: 11 }}>Curated listings in your interest areas</p>
                </div>
                <Toggle
                  checked={emailPrefs.subscribed}
                  onChange={(on) => {
                    saveEmailPrefs({ new_listings_email_subscribed: on });
                    if (!on) posthog.capture('email_alert_unsubscribed', { type: 'new_listings_digest', source: 'preferences_page' });
                  }}
                />
              </div>

              {/* Frequency selector (only when ON) */}
              {emailPrefs.subscribed && (
                <>
                  <div style={s.divider} />
                  <div style={{ paddingTop: 16 }}>
                    <p style={{ ...s.monoSmall, marginBottom: 8 }}>Frequency</p>
                    <FrequencySelector
                      value={emailPrefs.frequency}
                      onChange={(freq) => {
                        saveEmailPrefs({ new_listings_frequency: freq });
                        posthog.capture('email_alert_frequency_changed', { new_frequency: freq, source: 'preferences_page' });
                      }}
                    />
                  </div>
                </>
              )}

            </div>
          )}
        </section>

        {/* ── ADMIN TOOLS (bn5799@gmail.com only) ── */}
        {user.email === "bn5799@gmail.com" && (
          <section style={s.section}>
            <p style={s.sectionLabel}>Admin</p>
            <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
              {[
                { to: '/health',    icon: '⬡', label: 'System Health' },
                { to: '/analytics', icon: '◈', label: 'Analytics' },
              ].map(({ to, icon, label }, i, arr) => (
                <div key={to}>
                  <Link
                    to={to}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      letterSpacing: '0.04em',
                      color: 'var(--color-amber)',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '14px 18px',
                    }}
                  >
                    <span>{icon}</span>
                    <span>{label} →</span>
                  </Link>
                  {i < arr.length - 1 && <div style={s.divider} />}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── PREFERRED LOCALITIES ── */}
        <section style={s.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ ...s.sectionLabel, marginBottom: 0 }}>Preferred Localities</p>
            <button
              onClick={openLocalityPicker}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'none', border: '1px solid var(--color-border)',
                borderRadius: 7, padding: '4px 10px',
                color: 'var(--color-text-muted)', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.04em',
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
              <i className="fa-solid fa-plus" style={{ fontSize: 10 }} />
              <span>Add more</span>
            </button>
          </div>

          {/* ── Locality picker dropdown ── */}
          {addingLocalities && (
            <div style={{
              ...s.card, marginBottom: 12, padding: '14px 16px',
              border: '1px solid var(--color-amber)', borderRadius: 'var(--radius-card)',
            }}>
              <input
                type="text"
                placeholder="Add localities..."
                value={locFilter}
                onChange={e => setLocFilter(e.target.value)}
                autoFocus
                style={{
                  width: '100%', padding: '8px 10px', marginBottom: 10,
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)', borderRadius: 6,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
                {(() => {
                  const existingLocs = new Set(savedSearches.map(s => (s.location || s.name || '').toLowerCase()));
                  const filtered = allLocalities
                    .filter(l => !existingLocs.has(l.toLowerCase()))
                    .filter(l => !locFilter || l.toLowerCase().includes(locFilter.toLowerCase()));
                  if (allLocalities.length === 0) return <p style={s.monoSmall}>Loading...</p>;
                  if (filtered.length === 0) return <p style={s.monoSmall}>No matching localities</p>;
                  return filtered.map(loc => {
                    const isSelected = selectedNewLocs.has(loc);
                    return (
                      <label key={loc} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 4px', cursor: 'pointer',
                        borderRadius: 6,
                        background: isSelected ? 'rgba(245,166,35,0.08)' : 'transparent',
                      }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedNewLocs(prev => {
                              const next = new Set(prev);
                              if (next.has(loc)) next.delete(loc);
                              else next.add(loc);
                              return next;
                            });
                          }}
                          style={{ accentColor: 'var(--color-amber)' }}
                        />
                        <span style={{ fontSize: 14, fontFamily: 'var(--font-sans)' }}>{loc}</span>
                      </label>
                    );
                  });
                })()}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setAddingLocalities(false)}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    padding: '6px 14px', borderRadius: 6,
                    background: 'none', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-muted)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={addSelectedLocalities}
                  disabled={selectedNewLocs.size === 0}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                    padding: '6px 14px', borderRadius: 6,
                    background: selectedNewLocs.size > 0 ? 'var(--color-amber)' : 'var(--color-border)',
                    color: selectedNewLocs.size > 0 ? '#1a0a00' : 'var(--color-text-muted)',
                    border: 'none', cursor: selectedNewLocs.size > 0 ? 'pointer' : 'default',
                  }}
                >
                  Add{selectedNewLocs.size > 0 ? ` (${selectedNewLocs.size})` : ''}
                </button>
              </div>
            </div>
          )}

          {savedSearches.length === 0 && !addingLocalities ? (
            <div style={{ ...s.card, textAlign: 'center', padding: '32px' }}>
              <p style={s.monoSmall}>No preferred localities yet.</p>
              <p style={{ ...s.monoSmall, fontSize: 10, marginTop: 6 }}>
                Tap + above to add localities, or save listings to auto-add them.
              </p>
            </div>
          ) : (
            <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
              {savedSearches.map((search, i) => {
                const loc = search.location || search.name || '';
                const disabled = (emailPrefs?.disabledLocalities || []);
                const isEnabled = !disabled.some(d => d.toLowerCase() === loc.toLowerCase());

                function toggleLocality(on) {
                  const updated = on
                    ? disabled.filter(d => d.toLowerCase() !== loc.toLowerCase())
                    : [...disabled, loc];
                  saveEmailPrefs({ disabled_localities: updated });
                }

                return (
                <div key={search.id}>
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 18px',
                    gap: 10,
                  }}>
                    {/* Left: locality name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 400, fontSize: 15, opacity: isEnabled ? 1 : 0.45 }}>
                        {loc}
                      </p>
                      {(search.bhk || formatBudget(search.budget)) && (
                        <p style={{ ...s.monoSmall, fontSize: 10, marginTop: 2, opacity: isEnabled ? 1 : 0.45 }}>
                          {[search.bhk, formatBudget(search.budget)].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>

                    {/* Right: search icon + toggle + delete */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <Link
                        to={`/app?q=${encodeURIComponent(loc)}`}
                        aria-label={`Search ${loc}`}
                        style={{
                          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          background: 'none',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text-muted)',
                          textDecoration: 'none',
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
                        <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 11 }} />
                      </Link>

                      <Toggle checked={isEnabled} onChange={toggleLocality} />

                      <button
                        onClick={() => removeSearch(search.id)}
                        aria-label={`Remove ${loc}`}
                        style={{
                          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          background: 'none', border: '1px solid var(--color-border)',
                          color: 'var(--color-text-muted)', cursor: 'pointer',
                          padding: 0, transition: 'border-color 0.2s, color 0.2s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = '#e05555';
                          e.currentTarget.style.color = '#e05555';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = 'var(--color-border)';
                          e.currentTarget.style.color = 'var(--color-text-muted)';
                        }}
                      >
                        <i className="fa-solid fa-trash-can" style={{ fontSize: 11 }} />
                      </button>
                    </div>
                  </div>

                  {i < savedSearches.length - 1 && <div style={s.divider} />}
                </div>
                );
              })}
            </div>
          )}
        </section>


      </div>

      {toast && <SimpleToast message={toast} onDone={() => setToast(null)} />}
      <BottomNav />
    </div>
  );
}
