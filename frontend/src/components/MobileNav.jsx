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
      id: 'pulse',
      label: 'Pulse',
      path: '/locality-guide',
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth={active ? 2.5 : 1.8}
          strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 12 6 12 8 5 10 19 12 12 14 15 16 12 22 12"/>
        </svg>
      ),
    },
    {
      id: 'new',
      label: 'My Hub',
      path: '/new',
      badge: user && totalCount > 0 ? totalCount : null,
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth={active ? 2.5 : 1.8}
          strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
          <polyline points="2 17 12 22 22 17"/>
          <polyline points="2 12 12 17 22 12"/>
        </svg>
      ),
    },
  ]

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    if (path === '/locality-guide') {
      return location.pathname === '/locality-guide' || location.pathname.startsWith('/neighbourhood-pulse')
    }
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
              fontSize: '11px',
              fontWeight: active ? '700' : '500',
              marginTop: '3px',
              letterSpacing: '0.2px',
              color: active ? '#f5a623' : 'var(--text-secondary)',
            }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
