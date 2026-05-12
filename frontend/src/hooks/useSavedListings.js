import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { trackLocalStorageSavesMerged } from '../lib/posthog'

const LS_KEY = 'nestiq_saved_listings_v2'

function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeLS(items) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items))
  } catch {}
}

// Migrate the old key used by App.jsx localStorage
function migrateOldLS() {
  try {
    const old = localStorage.getItem('savedListings')
    if (!old) return []
    const parsed = JSON.parse(old)
    if (!Array.isArray(parsed) || parsed.length === 0) return []
    return parsed
  } catch {
    return []
  }
}

export function useSavedListings(user) {
  const [savedListings, setSavedListings] = useState([])
  const [loading, setLoading] = useState(true)
  const inFlight = useRef(new Set())

  // Load on mount / user change
  useEffect(() => {
    if (user?.id) {
      loadFromSupabase()
    } else if (user === null) {
      // Not logged in — use localStorage
      const items = readLS().length > 0 ? readLS() : migrateOldLS()
      setSavedListings(items)
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // When user logs in, migrate localStorage saves to Supabase
  useEffect(() => {
    if (user?.id) {
      migrateToSupabase()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const loadFromSupabase = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('saved_listings')
      .select('*')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })
    if (!error && data) {
      const items = data.map(row => ({
        ...row.listing_snapshot,
        _saved_id: row.id,
        _status: row.status,
        _notes: row.notes || '',
        _saved_at: row.saved_at,
        id: row.listing_id,
      }))
      setSavedListings(items)
      writeLS(items)
    }
    setLoading(false)
  }

  const migrateToSupabase = async () => {
    const doneKey = `nestiq_sl_migrated_${user.id}`
    if (localStorage.getItem(doneKey)) return
    localStorage.setItem(doneKey, '1')

    const local = readLS().length > 0 ? readLS() : migrateOldLS()
    if (!local.length) return

    const rows = local.map(post => ({
      user_id: user.id,
      listing_id: String(post.id),
      status: post._status || 'saved',
      notes: post._notes || null,
      listing_snapshot: post,
    }))

    const { error } = await supabase
      .from('saved_listings')
      .upsert(rows, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })

    if (!error) {
      trackLocalStorageSavesMerged({ count: rows.length })
      localStorage.removeItem('savedListings')
      loadFromSupabase()
    } else {
      localStorage.removeItem(doneKey)
    }
  }

  const isSaved = useCallback(
    (postId) => savedListings.some(p => String(p.id) === String(postId)),
    [savedListings]
  )

  const saveListing = useCallback(async (post) => {
    const postId = String(post.id)

    // Guard: ignore duplicate in-flight calls for the same listing
    if (inFlight.current.has(postId)) return
    inFlight.current.add(postId)

    try {
      const alreadySaved = isSaved(postId)

      if (alreadySaved) {
        // Optimistic remove — update UI immediately, then sync to Supabase
        setSavedListings(prev => {
          const updated = prev.filter(p => String(p.id) !== postId)
          if (!user?.id) writeLS(updated)
          return updated
        })
        if (user?.id) {
          await supabase
            .from('saved_listings')
            .delete()
            .eq('user_id', user.id)
            .eq('listing_id', postId)
        }
      } else {
        // Save
        const enriched = {
          ...post,
          _status: 'saved',
          _notes: '',
          _saved_at: new Date().toISOString(),
        }
        if (user?.id) {
          const { data, error } = await supabase
            .from('saved_listings')
            .insert({
              user_id: user.id,
              listing_id: postId,
              status: 'saved',
              notes: null,
              listing_snapshot: post,
            })
            .select()
            .single()
          if (!error && data) {
            enriched._saved_id = data.id
          }
        }
        setSavedListings(prev => {
          const updated = [enriched, ...prev]
          if (!user?.id) writeLS(updated)
          return updated
        })
      }
    } finally {
      inFlight.current.delete(postId)
    }
  }, [user, isSaved])

  const updateStatus = useCallback(async (postId, newStatus) => {
    if (user?.id) {
      await supabase
        .from('saved_listings')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('listing_id', String(postId))
    }
    setSavedListings(prev => {
      const updated = prev.map(p =>
        String(p.id) === String(postId) ? { ...p, _status: newStatus } : p
      )
      if (!user?.id) writeLS(updated)
      return updated
    })
  }, [user])

  const updateNotes = useCallback(async (postId, notes) => {
    if (user?.id) {
      await supabase
        .from('saved_listings')
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('listing_id', String(postId))
    }
    setSavedListings(prev => {
      const updated = prev.map(p =>
        String(p.id) === String(postId) ? { ...p, _notes: notes } : p
      )
      if (!user?.id) writeLS(updated)
      return updated
    })
  }, [user])

  const clearAllSaved = useCallback(async () => {
    if (user?.id) {
      await supabase
        .from('saved_listings')
        .delete()
        .eq('user_id', user.id)
    }
    setSavedListings([])
    localStorage.removeItem(LS_KEY)
    localStorage.removeItem('savedListings')
  }, [user])

  return {
    savedListings,
    savedCount: savedListings.length,
    loading,
    isSaved,
    saveListing,
    updateStatus,
    updateNotes,
    clearAllSaved,
    reload: loadFromSupabase,
  }
}
