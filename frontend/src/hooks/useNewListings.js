import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''
const CACHE_KEY = 'nestiq_new_listings_v1'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch {}
}

function clearCache() {
  try { sessionStorage.removeItem(CACHE_KEY) } catch {}
}

async function fetchOneSearch(search, sinceOverride) {
  const since = sinceOverride || search.last_run_at || search.created_at
  if (!since) return null

  const params = new URLSearchParams()
  if (search.location) params.append('location', search.location)
  if (search.bhk && search.bhk !== 'any') params.append('bhk', search.bhk)
  if (search.budget) params.append('budget', search.budget)
  if (search.keywords) params.append('keywords', search.keywords)
  if (search.sources?.length) params.append('sources', search.sources.join(','))
  params.append('since', since)
  params.append('limit', '20')

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const resp = await fetch(`${API_BASE}/api/search/new?${params}`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data.listings?.length) return null
    return { search, listings: data.listings, count: data.listings.length }
  } catch {
    return null
  }
}

export function useNewListings(user, savedSearches, sinceOverride) {
  const [newListings, setNewListings] = useState({})
  const [badgeCount, setBadgeCount] = useState(0)   // always "since last_run_at"
  const [totalCount, setTotalCount] = useState(0)   // reflects current window
  const [loading, setLoading] = useState(false)
  const fetchingRef = useRef(false)

  // Recompute totalCount whenever newListings changes
  useEffect(() => {
    setTotalCount(Object.values(newListings).reduce((sum, v) => sum + v.count, 0))
  }, [newListings])

  useEffect(() => {
    if (!user || !savedSearches?.length) {
      setNewListings({})
      setTotalCount(0)
      setBadgeCount(0)
      clearCache()
      return
    }

    // Immediately restore from cache for instant render (only when no override)
    if (!sinceOverride) {
      const cached = readCache()
      if (cached) setNewListings(cached)
    } else {
      setNewListings({})
    }

    // Always refresh in background (parallel fetches)
    fetchNewListings()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, savedSearches, sinceOverride])

  const fetchNewListings = useCallback(async () => {
    if (fetchingRef.current || !savedSearches?.length) return
    fetchingRef.current = true
    setLoading(true)

    // Badge: always fetch against last_run_at (no override) — run once for counts
    const badgePromises = savedSearches.map(s =>
      fetchOneSearch(s, null).then(r => r ? r.count : 0)
    )
    Promise.allSettled(badgePromises).then(results => {
      const total = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0)
      setBadgeCount(total)
    })

    // Visible results: use sinceOverride if set
    const promises = savedSearches.map(search =>
      fetchOneSearch(search, sinceOverride).then(result => {
        if (!result) return
        setNewListings(prev => {
          const next = { ...prev, [search.id]: result }
          if (!sinceOverride) writeCache(next)
          return next
        })
      })
    )

    await Promise.allSettled(promises)
    setLoading(false)
    fetchingRef.current = false
  }, [savedSearches, sinceOverride])

  const markAllSeen = async () => {
    if (!user) return
    const now = new Date().toISOString()
    await Promise.all(
      Object.keys(newListings).map(searchId =>
        supabase.from('saved_searches').update({ last_run_at: now }).eq('id', searchId)
      )
    )
    setNewListings({})
    setTotalCount(0)
    clearCache()
  }

  return { newListings, totalCount, badgeCount, loading, fetchNewListings, markAllSeen }
}
