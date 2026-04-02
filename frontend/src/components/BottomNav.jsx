import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  {
    label: 'Home',
    icon: 'fa-solid fa-house',
    to: '/',
    match: path => path === '/',
  },
  {
    label: 'Search',
    icon: 'fa-solid fa-magnifying-glass',
    to: '/app',
    match: path => path.startsWith('/app') || path.startsWith('/listing'),
  },
  {
    label: 'Pulse',
    icon: 'fa-solid fa-chart-line',
    to: '/locality-guide',
    match: path => path.startsWith('/locality-guide') || path.startsWith('/neighbourhood-pulse'),
  },
  {
    label: 'My Hub',
    icon: 'fa-solid fa-bookmark',
    to: '/new',
    match: path => path.startsWith('/new'),
  },
];

export default function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav className="nestiq-bottom-nav" style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      display: 'flex',
      background: 'rgba(10,10,10,0.92)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid var(--color-border)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {TABS.map(tab => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '10px 0 12px',
              textDecoration: 'none',
              color: active ? 'var(--color-amber)' : 'var(--color-text-muted)',
              borderTop: active ? '1px solid var(--color-amber)' : '1px solid transparent',
              marginTop: -1,
              transition: 'color 0.2s',
            }}
          >
            <i className={tab.icon} style={{ fontSize: 17, lineHeight: 1 }} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
