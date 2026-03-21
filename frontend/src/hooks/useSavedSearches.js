import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const LOCALSTORAGE_KEY = 'nestiq_saved_searches'

export function useSavedSearches(user) {
  const [savedSearches, setSavedSearches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      loadFromSupabase()
    } else {
      loadFromLocalStorage()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const loadFromSupabase = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('saved_searches')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setSavedSearches(data)
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(data))
    }
    setLoading(false)
  }

  const loadFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem(LOCALSTORAGE_KEY)
      setSavedSearches(stored ? JSON.parse(stored) : [])
    } catch {
      setSavedSearches([])
    }
    setLoading(false)
  }

  const saveSearch = async (searchParams) => {
    const name = generateSearchName(searchParams)

    const newSearch = {
      name,
      location: searchParams.location || '',
      bhk: searchParams.bhk || '',
      budget: searchParams.budget ? parseInt(searchParams.budget) : null,
      keywords: searchParams.keywords || '',
      sources: searchParams.sources || ['telegram', 'nobroker', 'housing'],
      min_quality: searchParams.minQuality || 20,
    }

    if (user) {
      const { data, error } = await supabase
        .from('saved_searches')
        .insert([{ ...newSearch, user_id: user.id }])
        .select()
        .single()

      if (!error && data) {
        setSavedSearches(prev => [data, ...prev])
        return data
      }
    } else {
      const localSearch = {
        ...newSearch,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      }
      const updated = [localSearch, ...savedSearches].slice(0, 10)
      setSavedSearches(updated)
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(updated))
      return localSearch
    }
  }

  const deleteSearch = async (searchId) => {
    if (user) {
      await supabase
        .from('saved_searches')
        .delete()
        .eq('id', searchId)
    }
    const updated = savedSearches.filter(s => s.id !== searchId)
    setSavedSearches(updated)
    if (!user) {
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(updated))
    }
  }

  const updateLastRun = async (searchId) => {
    const now = new Date().toISOString()
    if (user) {
      await supabase
        .from('saved_searches')
        .update({ last_run_at: now })
        .eq('id', searchId)
    }
    setSavedSearches(prev =>
      prev.map(s => s.id === searchId ? { ...s, last_run_at: now } : s)
    )
  }

  // Migrate localStorage searches to Supabase on first login
  const migrateLocalToSupabase = async () => {
    if (!user) return

    const stored = localStorage.getItem(LOCALSTORAGE_KEY)
    if (!stored) return

    const localSearches = JSON.parse(stored)
    if (!localSearches.length) return

    const toInsert = localSearches.map(s => ({
      user_id: user.id,
      name: s.name,
      location: s.location || '',
      bhk: s.bhk || '',
      budget: s.budget || null,
      keywords: s.keywords || '',
      sources: s.sources || ['telegram', 'nobroker', 'housing'],
      min_quality: s.min_quality || 20,
    }))

    const { error } = await supabase
      .from('saved_searches')
      .insert(toInsert)

    if (!error) {
      localStorage.removeItem(LOCALSTORAGE_KEY)
      loadFromSupabase()
    }
  }

  useEffect(() => {
    if (user) {
      migrateLocalToSupabase()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return {
    savedSearches,
    loading,
    saveSearch,
    deleteSearch,
    updateLastRun,
  }
}

function generateSearchName(params) {
  const parts = []
  if (params.location) parts.push(params.location)
  if (params.bhk && params.bhk !== 'any') parts.push(params.bhk)
  if (params.budget) parts.push(`under ₹${parseInt(params.budget).toLocaleString()}`)
  if (params.keywords) parts.push(params.keywords)
  return parts.length > 0 ? parts.join(' · ') : 'All Bangalore listings'
}
