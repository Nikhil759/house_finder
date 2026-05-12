import posthog from 'posthog-js'

/** Set after successful init — guards capture helpers when key is missing. */
let clientReady = false

/** Prevents double init in HMR / repeated imports. */
const INIT_FLAG = '__posthog_client_initialized__'

const INTERNAL_LS_KEY = 'posthog_internal_user'

/**
 * If URL has ?internal=true, persist internal flag and return true.
 * Otherwise read from localStorage (persists across the session).
 */
function resolveInternalUser() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('internal') === 'true') {
      localStorage.setItem(INTERNAL_LS_KEY, 'true')
      return true
    }
    return localStorage.getItem(INTERNAL_LS_KEY) === 'true'
  } catch {
    return false
  }
}

/** Super properties on every event when internal. */
function applyInternalSuperProperties() {
  if (resolveInternalUser()) {
    posthog.register({ internal_user: true })
  }
}

/**
 * Initialize PostHog once per page load. Safe to call multiple times.
 * @returns {boolean} true if init ran with a valid key
 */
export function initPostHog() {
  if (typeof window === 'undefined') return false
  if (window[INIT_FLAG]) return clientReady

  const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
  if (!key) {
    if (import.meta.env.DEV) {
      console.warn('[PostHog] VITE_PUBLIC_POSTHOG_KEY is not set; analytics disabled.')
    }
    return false
  }

  posthog.init(key, {
    api_host: 'https://app.posthog.com',
    capture_pageview: false,
    persistence: 'localStorage+cookie',
  })

  applyInternalSuperProperties()

  window[INIT_FLAG] = true
  clientReady = true
  return true
}

export function isPostHogReady() {
  return clientReady
}

/** Dedupe rapid duplicate fires (e.g. React 18 Strict Mode dev double-invoke). */
let lastPagePath = null
let lastPageAt = 0
const PAGE_VIEW_DEDUPE_MS = 100

export function trackPageView(pathname) {
  if (!clientReady) return
  const now = Date.now()
  if (lastPagePath === pathname && now - lastPageAt < PAGE_VIEW_DEDUPE_MS) return
  lastPagePath = pathname
  lastPageAt = now
  posthog.capture('page_view', { pathname })
}

export function trackSearch(query) {
  if (!clientReady) return
  posthog.capture('search', {
    query: typeof query === 'string' ? query : String(query ?? ''),
  })
}

export function trackListingClick(listingId) {
  if (!clientReady) return
  posthog.capture('listing_click', {
    listing_id: listingId,
  })
}

// ── Listing flag analytics ───────────────────────────────────────────────────
// All flag events include `signed_in` so we can later split engagement by auth
// status without changing UI behaviour. Variant is 'card' or 'detail'.

export function trackFlagButtonClicked({ listingId, variant, signedIn }) {
  if (!clientReady) return
  posthog.capture('listing_flag_button_clicked', {
    listing_id: listingId,
    variant,
    signed_in: !!signedIn,
  })
}

export function trackFlagModalOpened({ listingId, variant, signedIn }) {
  if (!clientReady) return
  posthog.capture('listing_flag_modal_opened', {
    listing_id: listingId,
    variant,
    signed_in: !!signedIn,
  })
}

export function trackFlagSubmitted({ listingId, category, hasNote, signedIn }) {
  if (!clientReady) return
  posthog.capture('listing_flag_submitted', {
    listing_id: listingId,
    category,
    has_note: !!hasNote,
    signed_in: !!signedIn,
  })
}

export function trackFlagRetracted({ listingId, signedIn }) {
  if (!clientReady) return
  posthog.capture('listing_flag_retracted', {
    listing_id: listingId,
    signed_in: !!signedIn,
  })
}

// ── Listing view tracking ────────────────────────────────────────────────────
// Fired AFTER the server confirms the view was logged. `deduped: true` means
// the server skipped the insert because this device viewed the same listing
// in the last 24h (the 'true' count lives in our DB, not PostHog — see
// backend/view_store.py).

export function trackListingViewLogged({ listingId, deduped }) {
  if (!clientReady) return
  posthog.capture('listing_view_logged', {
    listing_id: listingId,
    deduped: !!deduped,
  })
}

// ── Save / sign-in flow analytics ─────────────────────────────────────────────

export function trackSaveListing({ listingId, signedIn }) {
  if (!clientReady) return
  posthog.capture('save_listing', { listing_id: listingId, signed_in: !!signedIn })
}

export function trackUnsaveListing({ listingId, signedIn }) {
  if (!clientReady) return
  posthog.capture('unsave_listing', { listing_id: listingId, signed_in: !!signedIn })
}

export function trackFirstSaveToastShown() {
  if (!clientReady) return
  posthog.capture('first_save_toast_shown')
}

export function trackFirstSaveToastHubClicked() {
  if (!clientReady) return
  posthog.capture('first_save_toast_myhub_clicked')
}

export function trackSigninNudgeShown({ source }) {
  if (!clientReady) return
  posthog.capture('signin_nudge_shown', { source })
}

export function trackSigninNudgeDismissed({ source }) {
  if (!clientReady) return
  posthog.capture('signin_nudge_dismissed', { source })
}

export function trackSigninCompleted({ source }) {
  if (!clientReady) return
  posthog.capture('signin_completed', { source })
}

export function trackLocalStorageSavesMerged({ count }) {
  if (!clientReady) return
  posthog.capture('localstorage_saves_merged', { count })
}

/**
 * After auth when you have a stable user id (e.g. Supabase user.id).
 * @example identifyUser(session.user.id, { email: session.user.email })
 */
export function identifyUser(userId, traits = {}) {
  if (!clientReady || !userId) return
  posthog.identify(userId, traits)
}

/** Call on logout so the next visitor is not merged with the previous person. */
export function resetPostHog() {
  if (!clientReady) return
  posthog.reset()
}

export { posthog }
