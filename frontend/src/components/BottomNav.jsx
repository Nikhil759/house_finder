import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCity } from '../CityContext';
import { getNavItems } from '../lib/navConfig';

export default function BottomNav() {
  const { pathname } = useLocation();
  const { city } = useCity();
  const tabs = getNavItems(city).filter(item => !item.hideOnMobile);

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
      {tabs.map(tab => {
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
              color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
              borderTop: active ? '1px solid var(--color-accent)' : '1px solid transparent',
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
