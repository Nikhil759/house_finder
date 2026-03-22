import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from '../lib/posthog'

/**
 * Fires page_view on route changes. Must be used under BrowserRouter.
 */
export function usePageTracking() {
  const location = useLocation()

  useEffect(() => {
    const pathname = location.pathname
    trackPageView(pathname)
  }, [location.pathname])
}
