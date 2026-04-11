import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useAuth } from '../hooks/useAuth';
import { useSavedSearches } from '../hooks/useSavedSearches';
import { useDesktop } from '../hooks/useDesktop';

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


// ── Main page ─────────────────────────────────────────────────────────────────
export default function Profile() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { savedSearches, deleteSearch } = useSavedSearches(user);
  const isDesktop = useDesktop();

  function removeSearch(id) {
    deleteSearch(id);
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

        {/* ── ADMIN TOOLS (bn5799@gmail.com only) ── */}
        {user.email === "bn5799@gmail.com" && (
          <section style={s.section}>
            <p style={s.sectionLabel}>Admin</p>
            <div style={s.card}>
              <Link
                to="/health"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  letterSpacing: '0.04em',
                  color: 'var(--color-amber)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>⬡</span>
                <span>System Health →</span>
              </Link>
            </div>
          </section>
        )}

        {/* ── SAVED SEARCHES ── */}
        <section style={s.section}>
          <p style={s.sectionLabel}>Saved Searches</p>

          {savedSearches.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: '32px' }}>
              <p style={s.monoSmall}>No saved searches yet.</p>
              <Link to="/app" style={{
                display: 'inline-block', marginTop: 12,
                fontFamily: 'var(--font-mono)', fontSize: 12,
                color: 'var(--color-amber)', textDecoration: 'none',
              }}>
                Go to Search →
              </Link>
            </div>
          ) : (
            <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
              {savedSearches.map((search, i) => {
                const meta = [search.bhk, formatBudget(search.budget)]
                  .filter(Boolean).join(' · ');
                return (
                <div key={search.id}>
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                  }}>
                    {/* Search details */}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 300, fontSize: 16, marginBottom: 4 }}>
                        {search.location || search.name}
                      </p>
                      {meta && (
                        <p style={{ ...s.monoSmall }}>{meta}</p>
                      )}
                    </div>

                    {/* Right: date + actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 12 }}>
                      <span style={{ ...s.monoSmall, fontSize: 10 }}>{formatSavedOn(search.created_at)}</span>

                      {/* Run */}
                      <Link
                        to={`/app?q=${encodeURIComponent(search.location)}`}
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.04em',
                          background: 'var(--color-amber)', color: '#1a0a00',
                          borderRadius: 6, padding: '6px 14px',
                          textDecoration: 'none', fontWeight: 500,
                          transition: 'opacity 0.2s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      >
                        Run →
                      </Link>

                      {/* Remove */}
                      <button
                        onClick={() => removeSearch(search.id)}
                        aria-label="Remove saved search"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--color-text-muted)', fontSize: 16, padding: 0,
                          lineHeight: 1, transition: 'color 0.2s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Divider between rows (not after last) */}
                  {i < savedSearches.length - 1 && <div style={s.divider} />}
                </div>
                );
              })}
            </div>
          )}
        </section>


      </div>

      <BottomNav />
    </div>
  );
}
