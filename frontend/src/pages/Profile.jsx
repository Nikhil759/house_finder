import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext'
import { useAuth } from '../hooks/useAuth'
import { useSavedSearches } from '../hooks/useSavedSearches'
import { BackgroundPattern } from '../components/BackgroundPattern'
import { MobileNav } from '../components/MobileNav'
import Navbar from '../components/Navbar'
import { supabase } from '../lib/supabase'
import '../global.css'

const SOURCE_COLORS = {
  reddit:   '#ff4500',
  telegram: '#229ed9',
  nobroker: '#e63946',
  housing:  '#7c3aed',
}

export default function Profile() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { user, loading: authLoading, signOut } = useAuth()
  const { savedSearches, deleteSearch, clearAllSearches } = useSavedSearches(user)

  const [activeTab, setActiveTab]       = useState('searches')
  const [savedHomes, setSavedHomes]     = useState([])
  const [defaultPrefs, setDefaultPrefs] = useState({
    default_location: '',
    default_bhk: '',
    default_budget: '',
  })
  const [savingPrefs, setSavingPrefs]   = useState(false)
  const [prefsSaved,  setPrefsSaved]    = useState(false)

  // Redirect if not logged in — wait until auth has resolved
  useEffect(() => {
    if (!authLoading && user === null) navigate('/')
  }, [user, authLoading, navigate])

  // Load saved homes from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('savedListings')
      setSavedHomes(stored ? JSON.parse(stored) : [])
    } catch {
      setSavedHomes([])
    }
  }, [])

  // Load default preferences from Supabase
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setDefaultPrefs({
            default_location: data.default_location || '',
            default_bhk:      data.default_bhk || '',
            default_budget:   data.default_budget ? data.default_budget.toString() : '',
          })
        }
      })
  }, [user])

  const saveDefaultPrefs = async () => {
    if (!user) return
    setSavingPrefs(true)
    await supabase
      .from('user_preferences')
      .upsert({
        user_id:          user.id,
        default_location: defaultPrefs.default_location,
        default_bhk:      defaultPrefs.default_bhk,
        default_budget:   defaultPrefs.default_budget
          ? parseInt(defaultPrefs.default_budget) : null,
        updated_at: new Date().toISOString(),
      })
    setSavingPrefs(false)
    setPrefsSaved(true)
    setTimeout(() => setPrefsSaved(false), 2000)
  }

  const removeHome = (homeId) => {
    const updated = savedHomes.filter(h => h.id !== homeId)
    setSavedHomes(updated)
    localStorage.setItem('savedListings', JSON.stringify(updated))
  }

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#0d0d14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '24px', color: '#f5a623' }} />
    </div>
  )

  if (!user) return null

  const tabs = [
    { id: 'searches',    label: 'Saved Searches', count: savedSearches.length },
    { id: 'homes',       label: 'Saved Homes',    count: savedHomes.length },
    { id: 'preferences', label: 'Preferences',    count: null },
  ]

  const inputStyle = {
    width: '100%',
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: '8px',
    padding: '10px 14px',
    color: 'var(--input-text)',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div className="app-page">
      <BackgroundPattern theme={theme} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar />

        <div style={{
          maxWidth: '860px',
          margin: '0 auto',
          padding: '32px 24px 60px',
        }}>

          {/* ── User header card ───────────────────────────────────────── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            marginBottom: '28px',
            padding: '20px 24px',
            background: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="avatar"
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    border: '2px solid rgba(245,166,35,0.4)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: 'rgba(245,166,35,0.15)',
                  border: '2px solid rgba(245,166,35,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '22px',
                  fontWeight: '700',
                  color: '#f5a623',
                  flexShrink: 0,
                }}>
                  {(user.user_metadata?.full_name?.[0] || user.email?.[0] || 'N').toUpperCase()}
                </div>
              )}
              <div>
                <div style={{
                  fontSize: '17px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  marginBottom: '3px',
                }}>
                  {user.user_metadata?.full_name || 'NestIQ User'}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {user.email}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {user.email === 'bn5799@gmail.com' && (
                <button
                  onClick={() => navigate('/stats')}
                  style={{
                    background: 'rgba(245,166,35,0.12)',
                    border: '1px solid rgba(245,166,35,0.3)',
                    borderRadius: '8px',
                    padding: '7px 12px',
                    color: '#f5a623',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  📊 Stats
                </button>
              )}
              <button
                onClick={signOut}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '7px 14px',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Sign out
              </button>
            </div>
          </div>

          {/* ── Tab bar ────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex',
            gap: '4px',
            marginBottom: '20px',
            background: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '4px',
            overflowX: 'auto',
          }}>
            {tabs.map(tab => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1,
                    minWidth: 'max-content',
                    padding: '8px 16px',
                    background: active ? 'rgba(245,166,35,0.15)' : 'transparent',
                    border: active ? '1px solid rgba(245,166,35,0.3)' : '1px solid transparent',
                    borderRadius: '8px',
                    color: active ? '#f5a623' : 'var(--text-secondary)',
                    fontSize: '13px',
                    fontWeight: active ? '600' : '400',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                  {tab.count !== null && tab.count > 0 && (
                    <span style={{
                      background: active ? '#f5a623' : 'var(--pill-bg)',
                      color: active ? '#000' : 'var(--text-secondary)',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: '700',
                      padding: '1px 6px',
                      lineHeight: '16px',
                    }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ── Tab panel ──────────────────────────────────────────────── */}
          <div style={{
            background: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '24px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Amber top accent line */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              height: '1px',
              background: 'linear-gradient(to right, transparent, #f5a623, transparent)',
            }} />

            {/* ── SAVED SEARCHES ──────────────────────────────────────── */}
            {activeTab === 'searches' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
                    Saved Searches
                  </h3>
                  {savedSearches.length > 0 && (
                    <button
                      onClick={() => { if (window.confirm('Delete all saved searches?')) clearAllSearches() }}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        transition: 'color 0.15s, border-color 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b'; e.currentTarget.style.borderColor = 'rgba(255,107,107,0.4)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                      Delete all
                    </button>
                  )}
                </div>
                {savedSearches.length === 0 ? (
                  <EmptyState
                    icon="fa-regular fa-magnifying-glass"
                    message="No saved searches yet"
                    action={{ label: 'Start searching →', onClick: () => navigate('/app') }}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {savedSearches.map(search => (
                      <div key={search.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        gap: '12px',
                        flexWrap: 'wrap',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', marginBottom: '3px' }}>
                            {search.name}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {search.last_run_at
                              ? `Last run: ${new Date(search.last_run_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                              : 'Never run'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={async () => {
                              // Treat "Run" as viewing the search now, so New For You
                              // compares against this timestamp going forward.
                              await supabase
                                .from('saved_searches')
                                .update({ last_run_at: new Date().toISOString() })
                                .eq('id', search.id)

                              const params = new URLSearchParams()
                              if (search.location) params.set('location', search.location)
                              if (search.bhk)      params.set('bhk', search.bhk)
                              if (search.budget)   params.set('budget', search.budget)
                              navigate(`/app?${params}`)
                            }}
                            style={actionBtnStyle('amber')}
                          >
                            Run →
                          </button>
                          <button
                            onClick={() => deleteSearch(search.id)}
                            style={actionBtnStyle('muted')}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── SAVED HOMES ─────────────────────────────────────────── */}
            {activeTab === 'homes' && (
              <div>
                <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
                  Saved Homes
                </h3>
                {savedHomes.length === 0 ? (
                  <EmptyState
                    icon="fa-regular fa-bookmark"
                    message="No saved homes yet"
                    sub="Click the bookmark icon on any listing to save it"
                  />
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: '12px',
                  }}>
                    {savedHomes.map(home => {
                      const color = SOURCE_COLORS[home.source] || '#888'
                      const url = home.url || (home.permalink ? `https://reddit.com${home.permalink}` : null)
                      return (
                        <div key={home.id} style={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: '10px',
                          padding: '14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                            <span style={{ fontSize: '11px', fontWeight: '600', color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              {home.source}
                            </span>
                            <button
                              onClick={() => removeHome(home.id)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}
                              onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
                              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                            >
                              <i className="fa-solid fa-xmark" />
                            </button>
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {home.title}
                          </div>
                          {(home.price || home.price_formatted) && (
                            <div style={{ fontSize: '13px', fontWeight: '700', color: '#f5a623' }}>
                              {home.price_formatted || `₹${(home.price || 0).toLocaleString()}`}
                            </div>
                          )}
                          {(home.locality || home.bhk) && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {[home.bhk, home.locality].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', display: 'inline-block', alignSelf: 'flex-start' }}
                            >
                              View listing →
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── PREFERENCES ─────────────────────────────────────────── */}
            {activeTab === 'preferences' && (
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
                  Default Search Preferences
                </h3>
                <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Pre-fill the search form every time you open NestIQ.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '400px' }}>

                  <div>
                    <label style={labelStyle}>Default Location</label>
                    <input
                      type="text"
                      placeholder="e.g. Whitefield, HSR Layout"
                      value={defaultPrefs.default_location}
                      onChange={e => setDefaultPrefs(p => ({ ...p, default_location: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Default BHK</label>
                    <select
                      value={defaultPrefs.default_bhk}
                      onChange={e => setDefaultPrefs(p => ({ ...p, default_bhk: e.target.value }))}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="">Any</option>
                      <option value="1 BHK">1 BHK</option>
                      <option value="2 BHK">2 BHK</option>
                      <option value="3 BHK">3 BHK</option>
                      <option value="4 BHK">4 BHK</option>
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Default Budget (₹/month)</label>
                    <input
                      type="number"
                      placeholder="e.g. 30000"
                      value={defaultPrefs.default_budget}
                      onChange={e => setDefaultPrefs(p => ({ ...p, default_budget: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>

                  <button
                    onClick={saveDefaultPrefs}
                    disabled={savingPrefs}
                    style={{
                      alignSelf: 'flex-start',
                      background: prefsSaved ? 'rgba(74,222,128,0.15)' : '#f5a623',
                      border: prefsSaved ? '1px solid rgba(74,222,128,0.35)' : 'none',
                      borderRadius: '8px',
                      padding: '10px 22px',
                      color: prefsSaved ? '#4ade80' : '#000',
                      fontWeight: '600',
                      fontSize: '13px',
                      cursor: savingPrefs ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {prefsSaved ? '✓ Saved' : savingPrefs ? 'Saving...' : 'Save Preferences'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
      <MobileNav />
    </div>
  )
}

// ── Small helpers ────────────────────────────────────────────────────────────

function EmptyState({ icon, message, sub, action }) {
  const navigate = useNavigate()
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
      <i className={icon} style={{ fontSize: '36px', marginBottom: '14px', display: 'block' }} />
      <p style={{ margin: '0 0 6px', fontSize: '14px' }}>{message}</p>
      {sub && <p style={{ margin: '0 0 16px', fontSize: '13px' }}>{sub}</p>}
      {action && (
        <button
          onClick={() => navigate('/app')}
          style={{
            marginTop: '4px',
            background: '#f5a623',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 18px',
            color: '#000',
            fontWeight: '600',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: '11px',
  fontWeight: '500',
  letterSpacing: '0.7px',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: '7px',
}

function actionBtnStyle(variant) {
  if (variant === 'amber') return {
    background: 'rgba(245,166,35,0.12)',
    border: '1px solid rgba(245,166,35,0.25)',
    borderRadius: '6px',
    padding: '5px 12px',
    color: '#f5a623',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  }
  return {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '5px 12px',
    color: 'var(--text-muted)',
    fontSize: '12px',
    cursor: 'pointer',
  }
}
