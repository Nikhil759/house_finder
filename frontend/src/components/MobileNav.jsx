import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useNewListings } from '../hooks/useNewListings'
import { useSavedSearches } from '../hooks/useSavedSearches'

export function MobileNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { savedSearches } = useSavedSearches(user)
  const { totalCount } = useNewListings(user, savedSearches)

  const tabs = [
    {
      id: 'home',
      label: 'Home',
      path: '/',
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth={active ? 2.5 : 1.8}
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
    },
    {
      id: 'search',
      label: 'Search',
      path: '/app',
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth={active ? 2.5 : 1.8}
          strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      ),
    },
    {
      id: 'new',
      label: 'Alerts',
      path: '/new',
      badge: user && totalCount > 0 ? totalCount : null,
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth={active ? 2.5 : 1.8}
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
      ),
    },
  ]

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const isLanding = location.pathname === '/'

  return (
    <nav className={`mobile-bottom-nav${isLanding ? ' mobile-bottom-nav-landing' : ''}`}>
      {tabs.map(tab => {
        const active = isActive(tab.path)
        return (
          <button
            key={tab.id}
            onClick={() => navigate(tab.path)}
            className="mobile-nav-tab"
            style={{
              color: active ? '#f5a623' : 'var(--text-muted)',
            }}
          >
            <div style={{
              position: 'relative',
              display: 'inline-flex',
            }}>
              {tab.icon(active)}
              {tab.badge && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-6px',
                  background: '#f5a623',
                  color: '#000',
                  borderRadius: '10px',
                  fontSize: '9px',
                  fontWeight: '700',
                  padding: '1px 4px',
                  minWidth: '14px',
                  textAlign: 'center',
                  lineHeight: '14px',
                }}>
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </div>
            <span style={{
              fontSize: '10px',
              fontWeight: active ? '600' : '400',
              marginTop: '3px',
              letterSpacing: '0.2px',
            }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
