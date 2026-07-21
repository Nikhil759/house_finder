import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthButton } from './AuthButton';
import { EncoreSidebarBadge } from './EncorePartner';
import { useCity } from '../CityContext';
import { getNavItems } from '../lib/navConfig';
import { CitySwitcher } from './CitySwitcher';
import Logo from './Logo';

export default function DesktopSidebar() {
  const { pathname } = useLocation();
  const { city } = useCity();
  const navItems = getNavItems(city);

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
        to={city === 'gurgaon' ? '/gurgaon' : '/'}
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
        <Logo size={28} />
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 300,
          fontSize: 20,
          letterSpacing: '-0.02em',
          color: city === 'gurgaon' ? 'var(--color-accent)' : 'var(--color-text-primary)',
        }}>
          Nest<span style={{
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
          }}>IQ</span>
        </span>
      </Link>

      {/* City switcher */}
      <div style={{ padding: '14px 20px 4px' }}>
        <CitySwitcher fullWidth />
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {navItems.map(item => {
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
                color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                background: active ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'transparent',
                borderLeft: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
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

      <EncoreSidebarBadge />

      {/* Footer: avatar + wordmark */}
      <div style={{
        padding: '14px 20px',
        borderTop: '0.5px solid #1a1a1a',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: '#333',
          textTransform: 'uppercase',
        }}>
          NestIQ · {city === 'gurgaon' ? 'Gurgaon' : 'Bangalore'}
        </span>
        <AuthButton />
      </div>
    </aside>
  );
}
