import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''

export function useNewListings(user, savedSearches) {
  const [newListings, setNewListings] = useState({})
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user || !savedSearches?.length) {
      setNewListings({})
      setTotalCount(0)
      return
    }
    fetchNewListings()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, savedSearches])

  const fetchNewListings = async () => {
    setLoading(true)
    const results = {}
    let total = 0

    for (const search of savedSearches) {
      // Older saved searches may not have last_run_at yet.
      // Fall back to created_at so New For You still works.
      const since = search.last_run_at || search.created_at
      if (!since) continue

      const params = new URLSearchParams()
      if (search.location) params.append('location', search.location)
      if (search.bhk && search.bhk !== 'any') params.append('bhk', search.bhk)
      if (search.budget) params.append('budget', search.budget)
      if (search.keywords) params.append('keywords', search.keywords)
      if (search.sources?.length) params.append('sources', search.sources.join(','))
      params.append('since', since)
      params.append('limit', '20')

      try {
        const resp = await fetch(`${API_BASE}/api/search/new?${params}`)
        const data = await resp.json()
        if (data.listings?.length) {
          results[search.id] = {
            search,
            listings: data.listings,
            count: data.listings.length,
          }
          total += data.listings.length
        }
      } catch (e) {
        console.error('Failed to fetch new listings for', search.name, e)
      }
    }

    setNewListings(results)
    setTotalCount(total)
    setLoading(false)
  }

  const markAllSeen = async () => {
    if (!user) return
    const now = new Date().toISOString()
    for (const searchId of Object.keys(newListings)) {
      await supabase
        .from('saved_searches')
        .update({ last_run_at: now })
        .eq('id', searchId)
    }
    setNewListings({})
    setTotalCount(0)
  }

  return { newListings, totalCount, loading, fetchNewListings, markAllSeen }
}
