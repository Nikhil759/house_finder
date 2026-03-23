import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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
      status: post._status || 'interested',
      notes: post._notes || null,
      listing_snapshot: post,
    }))

    const { error } = await supabase
      .from('saved_listings')
      .upsert(rows, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })

    if (!error) {
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
    const alreadySaved = isSaved(post.id)

    if (alreadySaved) {
      // Unsave
      if (user?.id) {
        await supabase
          .from('saved_listings')
          .delete()
          .eq('user_id', user.id)
          .eq('listing_id', String(post.id))
      }
      const updated = savedListings.filter(p => String(p.id) !== String(post.id))
      setSavedListings(updated)
      if (!user?.id) writeLS(updated)
    } else {
      // Save
      const enriched = {
        ...post,
        _status: 'interested',
        _notes: '',
        _saved_at: new Date().toISOString(),
      }
      if (user?.id) {
        const { data, error } = await supabase
          .from('saved_listings')
          .insert({
            user_id: user.id,
            listing_id: String(post.id),
            status: 'interested',
            notes: null,
            listing_snapshot: post,
          })
          .select()
          .single()
        if (!error && data) {
          enriched._saved_id = data.id
        }
      }
      const updated = [enriched, ...savedListings]
      setSavedListings(updated)
      if (!user?.id) writeLS(updated)
    }
  }, [user, savedListings, isSaved])

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
    loading,
    isSaved,
    saveListing,
    updateStatus,
    updateNotes,
    clearAllSaved,
    reload: loadFromSupabase,
  }
}
