import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import { useDesktop } from '../hooks/useDesktop';
import { captureApiError } from '../lib/posthog';
import { logStart, logSuccess, logError } from '../lib/apiLogger';

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatRentShort(n) {
  if (!n) return '—';
  const v = Number(n);
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}k`;
  return `₹${v}`;
}

function ListingRow({ listing, onClick }) {
  const cover = (listing.image_urls || [])[0] || listing.thumbnail_url;
  return (
    <article
      onClick={onClick}
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        padding: 14,
        marginBottom: 10,
        cursor: 'pointer',
        border: '1px solid var(--color-border)',
      }}
    >
      <div style={{
        width: 68,
        height: 68,
        borderRadius: 8,
        flexShrink: 0,
        background: cover ? `center / cover no-repeat url(${cover})` : 'var(--color-bg-card)',
      }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="type-data-lg" style={{ color: 'var(--color-accent)', marginBottom: 2 }}>
          {formatRentShort(listing.rent)}<span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>/mo</span>
        </p>
        <h4 style={{
          fontSize: 14, fontWeight: 500, marginBottom: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {listing.title || `${listing.bhk || ''} ${listing.property_type || ''}`.trim()}
        </h4>
        <p className="type-eyebrow" style={{ color: 'var(--color-text-muted)', fontSize: 11, margin: 0 }}>
          {[listing.bhk, listing.furnishing, listing.area_sqft ? `${listing.area_sqft} sqft` : null]
            .filter(Boolean).join(' · ')}
        </p>
      </div>
    </article>
  );
}

export default function SocietyDetail() {
  const isDesktop = useDesktop();
  const navigate = useNavigate();
  const { id } = useParams();
  const [society, setSociety] = useState(null);
  const [activeImage, setActiveImage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setActiveImage(0);
      const t0 = performance.now();
      logStart('/api/society/:id', { id });
      try {
        const res = await fetch(`${API_BASE}/api/society/${id}`);
        if (!res.ok) throw new Error(`society ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSociety(data);
        logSuccess('/api/society/:id', 1, performance.now() - t0);
      } catch (err) {
        logError('/api/society/:id', err.message, performance.now() - t0);
        captureApiError(err, { endpoint: '/api/society/:id' });
        if (!cancelled) setError(err.message || 'Failed to load society');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  const images = society?.image_urls || [];
  const mapsUrl = society?.latitude && society?.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${society.latitude},${society.longitude}`
    : null;

  return (
    <div className="nestiq-page-body" style={{
      background: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-sans)',
      minHeight: '100vh',
    }}>
      <DesktopSidebar />
      <AppHeader backTo />

      <div style={{
        padding: isDesktop ? '24px 32px 40px' : '0 0 100px',
        maxWidth: isDesktop ? 1000 : undefined,
        margin: isDesktop ? '0 auto' : undefined,
      }}>
        {loading ? (
          <p className="type-data" style={{
            padding: '60px 0', textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)',
          }}>
            Loading society…
          </p>
        ) : error ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Couldn't load this society.
            </p>
            <Link to="/gurgaon/societies" style={{ color: 'var(--color-accent)' }}>
              ← Back to Societies
            </Link>
          </div>
        ) : !society ? null : (
          <>
            {isDesktop && (
              <Link
                to="/gurgaon/societies"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  color: 'var(--color-text-muted)', textDecoration: 'none',
                  fontSize: 13, marginBottom: 16,
                }}
              >
                ← Back to Societies
              </Link>
            )}

            {/* ── Gallery ── */}
            <div style={{ padding: isDesktop ? 0 : '0 16px', marginBottom: 20 }}>
              <div style={{
                width: '100%',
                aspectRatio: isDesktop ? '16 / 7' : '4 / 3',
                borderRadius: isDesktop ? 'var(--radius-card)' : 0,
                overflow: 'hidden',
                background: images[activeImage]
                  ? `center / cover no-repeat url(${images[activeImage]})`
                  : 'var(--color-bg-surface)',
                display: images[activeImage] ? 'block' : 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: images.length > 1 ? 8 : 0,
              }}>
                {!images[activeImage] && (
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
                    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              {images.length > 1 && (
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                  {images.map((src, i) => (
                    <button
                      key={src + i}
                      onClick={() => setActiveImage(i)}
                      style={{
                        width: 52, height: 40, flexShrink: 0, border: 'none', padding: 0,
                        borderRadius: 6, cursor: 'pointer',
                        outline: i === activeImage ? '2px solid var(--color-accent)' : 'none',
                        background: `center / cover no-repeat url(${src})`,
                        opacity: i === activeImage ? 1 : 0.6,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: isDesktop ? 0 : '0 16px' }}>
              {/* ── Header ── */}
              <p className="type-eyebrow" style={{ color: 'var(--color-accent)', fontSize: 'var(--text-xs)', marginBottom: 6 }}>
                {society.locality ? society.locality.toUpperCase() : 'GURGAON'}
              </p>
              <h1 style={{
                fontWeight: 300, fontSize: isDesktop ? 28 : 22,
                letterSpacing: '-0.02em', marginBottom: 8,
              }}>
                {society.name}
              </h1>
              {society.developer && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 16 }}>
                  Developed by {society.developer}
                </p>
              )}

              {society.description && (
                <p className="type-prose" style={{ color: 'var(--color-text-primary)', marginBottom: 20 }}>
                  {society.description}
                </p>
              )}

              {/* ── Amenities ── */}
              {society.amenities && society.amenities.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                  {society.amenities.map(a => (
                    <span key={a} className="type-data" style={{
                      fontSize: 'var(--text-xs)',
                      background: 'var(--color-bg-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-pill)',
                      padding: '5px 12px',
                      color: 'var(--color-text-primary)',
                    }}>
                      {a}
                    </span>
                  ))}
                </div>
              )}

              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="type-data"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    color: 'var(--color-accent)', textDecoration: 'none',
                    fontSize: 'var(--text-xs)', marginBottom: 28,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 21s-7-6.6-7-11.2A7 7 0 0 1 19 9.8C19 14.4 12 21 12 21z" />
                    <circle cx="12" cy="9.8" r="2.4" />
                  </svg>
                  View on Google Maps
                </a>
              )}

              {/* ── Linked listings ── */}
              <h2 style={{
                fontWeight: 400, fontSize: 18, marginBottom: 14,
                display: 'flex', alignItems: 'baseline', gap: 8,
              }}>
                Listings
                <span className="type-eyebrow" style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                  {society.listings?.length || 0} active
                </span>
              </h2>

              {(!society.listings || society.listings.length === 0) ? (
                <p className="type-data" style={{
                  padding: '24px 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)',
                }}>
                  No active listings found in this society yet. Check back soon.
                </p>
              ) : (
                society.listings.map(listing => (
                  <ListingRow
                    key={listing.id}
                    listing={listing}
                    onClick={() => navigate(`/gurgaon/listing/${listing.id}`)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
