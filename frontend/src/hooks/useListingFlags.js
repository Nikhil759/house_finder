import { useCallback, useEffect, useRef, useState } from 'react'

const API_BASE  = import.meta.env.VITE_API_URL || ''
const DEVICE_LS_KEY = 'nestiq_flag_device_id'

// ── Categories (keep in sync with backend ALLOWED_CATEGORIES + FlagModal) ────
// "other" is intentionally last — it's a catch-all for reports that don't fit
// any of the specific reasons.
export const FLAG_CATEGORIES = [
  { key: 'already_rented',         label: 'Already rented / not available' },
  { key: 'fake_or_duplicate',      label: 'Fake or duplicate listing' },
  { key: 'photos_dont_match',      label: "Photos don't match property" },
  { key: 'contact_doesnt_work',    label: "Contact number doesn't work" },
  { key: 'wrong_price_or_details', label: 'Wrong price or details' },
  { key: 'not_a_listing',          label: 'Not a listing (spam / off-topic post)' },
  { key: 'other',                  label: 'Other' },
]

// Short labels for the card-level indicator chip ("⚠ 3 reports · already rented")
export const FLAG_SHORT_LABELS = {
  already_rented:         'already rented',
  fake_or_duplicate:      'fake / duplicate',
  photos_dont_match:      "photos don't match",
  contact_doesnt_work:    'dead contact',
  wrong_price_or_details: 'wrong details',
  not_a_listing:          'spam / off-topic',
  other:                  'other',
}

export function categoryLabel(key) {
  return FLAG_CATEGORIES.find(c => c.key === key)?.label || key
}

export function categoryShortLabel(key) {
  return FLAG_SHORT_LABELS[key] || categoryLabel(key)
}

// ── Stable device ID (RFC4122 v4) ────────────────────────────────────────────
function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: getRandomValues-based v4 generator (works on older mobile WKWebViews)
  const buf = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  buf[6] = (buf[6] & 0x0f) | 0x40
  buf[8] = (buf[8] & 0x3f) | 0x80
  const hex = [...buf].map(b => b.toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  )
}

/** Returns a stable per-browser device ID, generating + persisting on first call. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_LS_KEY)
    if (!id) {
      id = makeUuid()
      localStorage.setItem(DEVICE_LS_KEY, id)
    }
    return id
  } catch {
    // Private mode / storage blocked — generate a session-only id so flagging
    // still works for the duration of this page load.
    return makeUuid()
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────
/**
 * Manages flag state for a single listing on the detail page.
 *
 * @param {string|null} listingId  - composite "source_sourceid" string
 * @param {object|null} user       - Supabase user (optional; attached to flag if present)
 * @param {object} [opts]
 * @param {object|null} [opts.seedSummary]  - { count, top_category } embedded in initial fetch,
 *                                            so we render the indicator immediately without an extra request
 */
export function useListingFlags(listingId, user, opts = {}) {
  const { seedSummary = null } = opts
  const deviceId = useRef(getDeviceId())

  const [summary, setSummary] = useState(
    seedSummary ? {
      count: seedSummary.count || 0,
      top_category: seedSummary.top_category || null,
    } : { count: 0, top_category: null }
  )
  const [flags, setFlags]       = useState([])
  const [byCategory, setByCat]  = useState({})
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [submitting, setSubmit] = useState(false)

  const reload = useCallback(async () => {
    if (!listingId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/flags/${encodeURIComponent(listingId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummary({ count: data.count || 0, top_category: data.top_category || null })
      setFlags(data.flags || [])
      setByCat(data.by_category || {})
    } catch (err) {
      setError(err.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [listingId])

  useEffect(() => {
    if (!listingId) return
    reload()
  }, [listingId, reload])

  // The current device's own active flag, if any.
  const ownFlag = flags.find(f => f.device_id === deviceId.current) || null

  const submit = useCallback(async ({ category, note }) => {
    if (!listingId || submitting) return { ok: false }
    setSubmit(true)
    try {
      const res = await fetch(`${API_BASE}/api/flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listingId,
          category,
          note: note || null,
          device_id: deviceId.current,
          user_id: user?.id || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          code: data.code || data.error || 'unknown',
          existing: data.existing || null,
        }
      }
      // Refresh full list so the new flag (with its real ID) is in the array
      // for ownFlag matching + the reports section.
      await reload()
      return { ok: true, flag: data.flag, summary: data.summary }
    } catch (err) {
      return { ok: false, code: 'network', error: err.message }
    } finally {
      setSubmit(false)
    }
  }, [listingId, user, submitting, reload])

  const retract = useCallback(async (flagId) => {
    if (!flagId) return { ok: false }
    try {
      const res = await fetch(
        `${API_BASE}/api/flags/${encodeURIComponent(flagId)}`,
        {
          method: 'DELETE',
          headers: { 'X-Device-Id': deviceId.current },
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { ok: false, status: res.status, code: data.error || 'unknown' }
      }
      await reload()
      return { ok: true }
    } catch (err) {
      return { ok: false, code: 'network', error: err.message }
    }
  }, [reload])

  return {
    deviceId: deviceId.current,
    summary,
    flags,
    byCategory,
    ownFlag,
    loading,
    error,
    submitting,
    submit,
    retract,
    reload,
  }
}
