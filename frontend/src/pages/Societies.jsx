import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import { captureApiError } from '../lib/posthog';
import { logStart, logSuccess, logError } from '../lib/apiLogger';

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatDeveloper(society) {
  const parts = [society.developer, society.locality].filter(Boolean);
  return parts.join(' · ');
}

function SocietyCard({ society, onClick }) {
  const cover = (society.image_urls || [])[0];

  return (
    <article
      onClick={onClick}
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        cursor: 'pointer',
        border: '1px solid var(--color-border)',
        transition: 'transform 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--color-accent) 40%, transparent)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{
        width: '100%',
        aspectRatio: '4 / 3',
        background: cover
          ? `center / cover no-repeat url(${cover})`
          : 'var(--color-bg-card)',
        display: cover ? 'block' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {!cover && (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <div style={{ padding: '14px 16px 16px' }}>
        <h3 style={{
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: 4,
          lineHeight: 1.3,
        }}>
          {society.name}
        </h3>
        <p className="type-eyebrow" style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)',
          marginBottom: society.listing_count > 0 ? 10 : 0,
        }}>
          {formatDeveloper(society) || 'Gurgaon'}
        </p>
        {society.listing_count > 0 && (
          <span className="type-data" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-accent)',
            background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
            borderRadius: 'var(--radius-pill)',
            padding: '3px 10px',
          }}>
            {society.listing_count} listing{society.listing_count === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </article>
  );
}

export default function Societies() {
  const isDesktop = useDesktop();
  const navigate = useNavigate();
  const [societies, setSocieties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const t0 = performance.now();
      logStart('/api/societies', { city: 'gurgaon' });
      try {
        const res = await fetch(`${API_BASE}/api/societies?city=gurgaon`);
        if (!res.ok) throw new Error(`societies ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSocieties(data.societies || []);
        logSuccess('/api/societies', (data.societies || []).length, performance.now() - t0);
      } catch (err) {
        logError('/api/societies', err.message, performance.now() - t0);
        captureApiError(err, { endpoint: '/api/societies' });
        if (!cancelled) setError(err.message || 'Failed to load societies');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="nestiq-page-body" style={{
      background: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-sans)',
      minHeight: '100vh',
    }}>
      <DesktopSidebar />
      <AppHeader />

      <div style={{
        padding: isDesktop ? '24px 32px 40px' : '16px 16px 100px',
        maxWidth: isDesktop ? 1200 : undefined,
        margin: isDesktop ? '0 auto' : undefined,
      }}>
        <div style={{ marginBottom: 24 }}>
          <p className="type-eyebrow" style={{
            color: 'var(--color-accent)',
            marginBottom: 8,
            fontSize: 'var(--text-xs)',
          }}>
            GURGAON
          </p>
          <h1 style={{
            fontWeight: 300,
            fontSize: isDesktop ? 28 : 22,
            letterSpacing: '-0.02em',
            marginBottom: 6,
          }}>
            Societies
          </h1>
          <p style={{
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-sm)',
            maxWidth: 560,
          }}>
            Browse gated communities across Gurgaon — photos, amenities, and any active listings inside each one.
          </p>
        </div>

        {loading ? (
          <p className="type-data" style={{
            padding: '60px 0', textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)',
          }}>
            Loading societies…
          </p>
        ) : error ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Something went wrong loading societies. Please try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 20px', borderRadius: 8,
                border: '1px solid var(--color-accent)',
                background: 'transparent', color: 'var(--color-accent)',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : societies.length === 0 ? (
          <p className="type-data" style={{
            padding: '60px 0', textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)',
          }}>
            No societies found yet.
          </p>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)',
            gap: isDesktop ? 20 : 12,
          }}>
            {societies.map(society => (
              <SocietyCard
                key={society.id}
                society={society}
                onClick={() => navigate(`/gurgaon/societies/${society.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
