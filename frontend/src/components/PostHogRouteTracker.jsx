import { usePageTracking } from '../hooks/usePageTracking'

/** Renders nothing; must be a child of BrowserRouter. */
export default function PostHogRouteTracker() {
  usePageTracking()
  return null
}
