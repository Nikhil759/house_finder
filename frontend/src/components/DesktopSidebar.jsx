import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { label: 'Home',    icon: 'fa-solid fa-house',        to: '/',               match: p => p === '/' },
  { label: 'Search',  icon: 'fa-solid fa-magnifying-glass', to: '/app',        match: p => p.startsWith('/app') || p.startsWith('/listing') },
  { label: 'Pulse',   icon: 'fa-solid fa-chart-line',   to: '/locality-guide', match: p => p.startsWith('/locality-guide') || p.startsWith('/neighbourhood-pulse') },
  { label: 'My Hub',  icon: 'fa-solid fa-bookmark',     to: '/new',            match: p => p.startsWith('/new') },
  { label: 'Profile', icon: 'fa-solid fa-user',         to: '/profile',        match: p => p.startsWith('/profile') },
];

export default function DesktopSidebar() {
  const { pathname } = useLocation();

  return (
    <aside style={{
      position: 'fixed',
      left: 0,
      top: 0,
      bottom: 0,
      width: 240,
      background: '#111111',
      borderRight: '0.5px solid #222222',
      flexDirection: 'column',
      zIndex: 200,
    }} className="nestiq-desktop-sidebar">

      {/* Logo */}
      <Link
        to="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '24px 20px 20px',
          textDecoration: 'none',
          borderBottom: '0.5px solid #1a1a1a',
          flexShrink: 0,
        }}
      >
        <img src="/icon.svg" alt="NestIQ" style={{ width: 28, height: 28 }} />
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 300,
          fontSize: 20,
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
        }}>
          Nest<span style={{
            color: 'var(--color-amber)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
          }}>IQ</span>
        </span>
      </Link>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {NAV_ITEMS.map(item => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 20px',
                textDecoration: 'none',
                color: active ? 'var(--color-amber)' : 'var(--color-text-muted)',
                background: active ? 'rgba(232,160,32,0.06)' : 'transparent',
                borderLeft: `2px solid ${active ? 'var(--color-amber)' : 'transparent'}`,
                transition: 'color 0.15s, background 0.15s',
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                fontWeight: active ? 400 : 300,
                letterSpacing: '-0.01em',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <i className={item.icon} style={{ fontSize: 15, width: 18, textAlign: 'center', flexShrink: 0 }} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '16px 20px',
        borderTop: '0.5px solid #1a1a1a',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: '#333',
          textTransform: 'uppercase',
        }}>
          NestIQ · Bangalore
        </span>
      </div>
    </aside>
  );
}
