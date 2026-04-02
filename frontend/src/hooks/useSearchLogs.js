import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const LS_LOGS_KEY     = 'nestiq_search_logs'
const LS_MIGRATED_KEY = uid => `nestiq_slogs_migrated_${uid}`
const SESSION_KEY     = 'nestiq_session_id'

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

function readLocalLogs() {
  try { return JSON.parse(localStorage.getItem(LS_LOGS_KEY) || '[]') } catch { return [] }
}
function writeLocalLogs(logs) {
  try { localStorage.setItem(LS_LOGS_KEY, JSON.stringify(logs)) } catch {}
}
function clearLocalLogs() {
  localStorage.removeItem(LS_LOGS_KEY)
}

// Direct Supabase save — always checks for duplicates live, no stale-state risk.
async function supabaseSaveSearch(userId, locality) {
  const loc = (locality || '').trim()
  if (!loc || !userId) return false

  // Live duplicate check — don't rely on any hook's local state
  const { data: existing } = await supabase
    .from('saved_searches')
    .select('id')
    .eq('user_id', userId)
    .eq('location', loc)
    .limit(1)

  if (existing?.length > 0) return false // already saved

  const { data, error } = await supabase
    .from('saved_searches')
    .insert([{
      user_id:     userId,
      name:        loc,
      location:    loc,
      bhk:         '',
      keywords:    '',
      sources:     ['telegram', 'nobroker', 'housing'],
      min_quality: 20,
      last_run_at: new Date().toISOString(),
    }])
    .select()
    .single()

  return !error && !!data
}

/**
 * Manages search logs, auto-save triggers, and migration on login.
 *
 * No longer depends on useSavedSearches — saves go directly to Supabase
 * with a live duplicate check to avoid stale-state re-insertion bugs.
 *
 * @param {object|null} user - Current auth user (from useAuth)
 */
export function useSearchLogs(user) {
  const [toast, setToast] = useState(null)
  const timerRef       = useRef(null)
  // Tracks localities auto-saved this session — prevents re-triggering after user deletes
  const autoSavedRef   = useRef(new Set())

  function showToast(data, duration = 3000) {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(data)
    if (duration > 0) {
      timerRef.current = setTimeout(() => setToast(null), duration)
    }
  }

  function dismissToast() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(null)
  }

  // ── Log a search ────────────────────────────────────────────────────────────
  const logSearch = useCallback(async (locality, filters = {}) => {
    const loc = (locality || '').trim()
    if (!loc) return

    const entry = {
      locality:    loc,
      filters,
      searched_at: new Date().toISOString(),
    }

    if (user?.id) {
      try {
        await supabase.from('search_logs').insert({
          user_id:     user.id,
          session_id:  getSessionId(),
          locality:    entry.locality,
          filters:     entry.filters,
          searched_at: entry.searched_at,
        })
      } catch { /* table might not exist yet */ }
    } else {
      const logs = readLocalLogs()
      logs.push({ ...entry, session_id: getSessionId() })
      writeLocalLogs(logs.slice(-100))
    }
  }, [user?.id])

  // ── Count how many times this locality was searched ─────────────────────────
  const getLocalityCount = useCallback(async (locality) => {
    const loc = (locality || '').trim().toLowerCase()
    if (!loc) return 0

    if (user?.id) {
      try {
        const { count } = await supabase
          .from('search_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .ilike('locality', loc)
        return count || 0
      } catch { return 0 }
    } else {
      const logs = readLocalLogs()
      return logs.filter(l => l.locality?.toLowerCase() === loc).length
    }
  }, [user?.id])

  // ── Trigger 2: check repeat locality after logging and auto-save ─────────────
  const runTriggerChecks = useCallback(async (locality) => {
    const loc = (locality || '').trim()
    if (!loc) return

    // Skip if already handled this session (prevents re-triggering after user deletes)
    const key = loc.toLowerCase()
    if (autoSavedRef.current.has(key)) return

    const count = await getLocalityCount(loc)
    if (count < 2) return

    if (user?.id) {
      const saved = await supabaseSaveSearch(user.id, loc)
      autoSavedRef.current.add(key) // mark as handled regardless — don't keep retrying
      if (saved) {
        showToast({ type: 'info', message: `${loc} added to your saved searches` }, 3000)
      }
    } else {
      autoSavedRef.current.add(key)
      // Non-logged-in nudge — stays until dismissed
      showToast({ type: 'nudge', locality: loc }, 0)
    }
  }, [user?.id, getLocalityCount])

  // ── Trigger 1: heart tapped — auto-save the current search ──────────────────
  const onListingSaved = useCallback((locality) => {
    const loc = (locality || '').trim()
    if (!loc) return

    const key = loc.toLowerCase()
    if (autoSavedRef.current.has(key)) return
    autoSavedRef.current.add(key)

    if (user?.id) {
      supabaseSaveSearch(user.id, loc) // silent, fire-and-forget
    } else {
      showToast({ type: 'nudge', locality: loc }, 0)
    }
  }, [user?.id])

  // ── Migration: runs once when user first signs in ────────────────────────────
  useEffect(() => {
    if (!user?.id) return

    const doneKey = LS_MIGRATED_KEY(user.id)
    if (localStorage.getItem(doneKey)) return

    const logs = readLocalLogs()

    // Claim lock immediately to prevent double-run
    localStorage.setItem(doneKey, '1')

    if (!logs.length) return

    ;(async () => {
      try {
        const rows = logs.map(l => ({
          user_id:     user.id,
          locality:    l.locality || '',
          filters:     l.filters || {},
          searched_at: l.searched_at || new Date().toISOString(),
          session_id:  l.session_id || null,
        }))

        await supabase.from('search_logs').insert(rows)

        // Auto-save localities searched 2+ times — live duplicate check prevents re-insertion
        const counts = {}
        logs.forEach(l => {
          if (l.locality) counts[l.locality] = (counts[l.locality] || 0) + 1
        })
        for (const [locality, c] of Object.entries(counts)) {
          if (c >= 2) await supabaseSaveSearch(user.id, locality)
        }

        clearLocalLogs()
        showToast({ type: 'info', message: 'Your searches have been synced' }, 2500)
      } catch {
        // Roll back so migration can retry next login
        localStorage.removeItem(doneKey)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return { logSearch, runTriggerChecks, onListingSaved, toast, dismissToast }
}
