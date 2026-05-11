import { useEffect, useRef } from 'react'

import { getDeviceId } from './useListingFlags'
import { trackListingViewLogged } from '../lib/posthog'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * Fires a single view log to the backend for the given listing on mount.
 *
 * Notes:
 *   * Reuses the same per-browser device UUID as the flag feature
 *     (see useListingFlags.getDeviceId). The server enforces 24h dedupe per
 *     (listing_id, device_id) so the count stays meaningful even across
 *     refreshes / React 18 Strict-Mode double-mount in dev.
 *   * The PostHog event fires AFTER the server responds so we know the real
 *     `deduped` flag, instead of guessing client-side.
 *   * Best-effort: failures (network, blocked requests) are swallowed —
 *     view tracking never breaks the page.
 */
export function useLogListingView(listingId, user) {
  const fired = useRef(false)

  useEffect(() => {
    if (!listingId || fired.current) return
    fired.current = true

    let cancelled = false
    const deviceId = getDeviceId()

    fetch(`${API_BASE}/api/listing-views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listing_id: listingId,
        device_id:  deviceId,
        user_id:    user?.id || null,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data || !data.ok) return
        trackListingViewLogged({
          listingId,
          deduped: !!data.deduped,
        })
      })
      .catch(() => { /* swallow — view logging is best-effort */ })

    return () => { cancelled = true }
  }, [listingId, user?.id])
}
