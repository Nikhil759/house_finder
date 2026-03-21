import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext'
import { BackgroundPattern } from '../components/BackgroundPattern'
import Navbar from '../components/Navbar'
import '../global.css'

const SOURCE_COLORS = {
  nobroker: '#e63946',
  housing:  '#7c3aed',
  telegram: '#229ed9',
  reddit:   '#ff4500',
}

const SOURCE_LABELS = {
  nobroker: 'NoBroker',
  housing:  'Housing.com',
  telegram: 'Telegram',
  reddit:   'Reddit',
}

function formatPrice(price) {
  if (!price) return '—'
  if (price >= 100000) return `₹${(price / 100000).toFixed(1)}L`
  return `₹${parseInt(price).toLocaleString('en-IN')}`
}

export default function Insights() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedBhk, setSelectedBhk] = useState('2 BHK')

  useEffect(() => {
    fetch('/api/insights')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        setData(d)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  // Collect unique BHK types from the data for the filter buttons
  const bhkTypes = data
    ? [...new Set(data.locality_bhk?.map(r => r.bhk) ?? [])]
        .filter(Boolean)
        .sort()
    : ['1 BHK', '2 BHK', '3 BHK']

  const filteredLocalityRows = (data?.locality_bhk ?? [])
    .filter(r => r.bhk === selectedBhk)
    .sort((a, b) => a.avg_price - b.avg_price)
    .slice(0, 15)

  const allFilteredPrices = filteredLocalityRows.map(r => r.avg_price)
  const minFilteredPrice  = Math.min(...allFilteredPrices)
  const maxFilteredPrice  = Math.max(...allFilteredPrices)

  return (
    <div className="app-page">
      <BackgroundPattern theme={theme} />

      <Navbar subtitle="Market Insights" />

      <div style={{
        position:  'relative',
        zIndex:    1,
        maxWidth:  '1000px',
        margin:    '0 auto',
        padding:   '32px 24px',
      }}>

        {/* Page header */}
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{
            fontSize:   '24px',
            fontWeight: '700',
            color:      'var(--text-primary)',
            margin:     '0 0 6px',
          }}>
            Market Insights
          </h1>
          <p style={{
            fontSize: '14px',
            color:    'var(--text-secondary)',
            margin:   0,
          }}>
            {data
              ? `Based on ${(data.overall?.total_listings ?? 0).toLocaleString()} active listings across Bangalore`
              : 'Loading market data...'}
          </p>
        </div>

        {loading && (
          <div style={{
            textAlign: 'center',
            padding:   '80px 0',
            color:     'var(--text-muted)',
            fontSize:  '15px',
          }}>
            Crunching the numbers...
          </div>
        )}

        {error && (
          <div style={{
            textAlign: 'center',
            padding:   '80px 0',
            color:     'var(--text-muted)',
            fontSize:  '14px',
          }}>
            Failed to load insights. Try again later.
          </div>
        )}

        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* ── Stat cards ────────────────────────────────────────────── */}
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap:                 '12px',
            }}>
              {[
                { label: 'Total listings',     value: (data.overall?.total_listings ?? 0).toLocaleString() },
                { label: 'Localities covered', value: data.overall?.total_localities },
                { label: 'Citywide avg rent',  value: formatPrice(data.overall?.overall_avg_price) },
                { label: 'Lowest listing',     value: formatPrice(data.overall?.overall_min_price) },
              ].map(stat => (
                <div key={stat.label} style={{
                  background:    'var(--bg-card)',
                  backdropFilter:'blur(16px)',
                  border:        '1px solid var(--border)',
                  borderRadius:  '12px',
                  padding:       '16px',
                  textAlign:     'center',
                }}>
                  <div style={{
                    fontSize:     '22px',
                    fontWeight:   '700',
                    color:        '#f5a623',
                    marginBottom: '4px',
                  }}>
                    {stat.value ?? '—'}
                  </div>
                  <div style={{
                    fontSize:      '11px',
                    color:         'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Source breakdown ──────────────────────────────────────── */}
            <Card accentColor="#f5a623" title="Listings by source">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(data.source_breakdown ?? []).map(source => {
                  const total = data.overall?.total_listings || 1
                  const pct   = Math.round((source.listing_count / total) * 100)
                  const color = SOURCE_COLORS[source.source] || '#888'
                  return (
                    <div key={source.source}>
                      <div style={{
                        display:        'flex',
                        justifyContent: 'space-between',
                        marginBottom:   '5px',
                        fontSize:       '13px',
                      }}>
                        <span style={{ color, fontWeight: '500' }}>
                          {SOURCE_LABELS[source.source] || source.source}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {source.listing_count} listings · {pct}%
                        </span>
                      </div>
                      <div style={{
                        height:       '6px',
                        background:   'var(--pill-bg)',
                        borderRadius: '3px',
                        overflow:     'hidden',
                      }}>
                        <div style={{
                          height:     '100%',
                          width:      `${pct}%`,
                          background: color,
                          borderRadius: '3px',
                          transition: 'width 0.6s ease',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* ── BHK price distribution ────────────────────────────────── */}
            <Card accentColor="#f5a623" title="Citywide price by BHK type">
              <div style={{
                display:             'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap:                 '10px',
              }}>
                {(data.bhk_distribution ?? []).map(bhk => (
                  <div key={bhk.bhk} style={{
                    background:   'var(--bg-secondary)',
                    border:       '1px solid var(--border)',
                    borderRadius: '10px',
                    padding:      '14px',
                    textAlign:    'center',
                  }}>
                    <div style={{
                      fontSize:     '13px',
                      fontWeight:   '600',
                      color:        'var(--text-primary)',
                      marginBottom: '8px',
                    }}>
                      {bhk.bhk}
                    </div>
                    <div style={{
                      fontSize:     '18px',
                      fontWeight:   '700',
                      color:        '#f5a623',
                      marginBottom: '4px',
                    }}>
                      {formatPrice(bhk.avg_price)}
                    </div>
                    <div style={{
                      fontSize:     '11px',
                      color:        'var(--text-muted)',
                      marginBottom: '6px',
                    }}>
                      avg / month
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {formatPrice(bhk.min_price)} – {formatPrice(bhk.max_price)}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {bhk.listing_count} listings
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* ── Locality comparison table ──────────────────────────────── */}
            <Card
              accentColor="#f5a623"
              title="Locality comparison"
              headerRight={
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {bhkTypes.map(bhk => (
                    <button
                      key={bhk}
                      onClick={() => setSelectedBhk(bhk)}
                      style={{
                        background:   selectedBhk === bhk ? 'rgba(245,166,35,0.15)' : 'transparent',
                        border:       selectedBhk === bhk ? '1px solid rgba(245,166,35,0.3)' : '1px solid var(--border)',
                        borderRadius: '6px',
                        padding:      '4px 10px',
                        color:        selectedBhk === bhk ? '#f5a623' : 'var(--text-secondary)',
                        fontSize:     '12px',
                        cursor:       'pointer',
                      }}
                    >
                      {bhk}
                    </button>
                  ))}
                </div>
              }
            >
              {/* Table header */}
              <div style={{
                display:             'grid',
                gridTemplateColumns: '1fr 90px 100px 70px 80px',
                padding:             '8px 12px',
                borderBottom:        '1px solid var(--border)',
                fontSize:            '11px',
                fontWeight:          '500',
                color:               'var(--text-muted)',
                textTransform:       'uppercase',
                letterSpacing:       '0.5px',
              }}>
                <span>Locality</span>
                <span style={{ textAlign: 'right' }}>Avg rent</span>
                <span style={{ textAlign: 'right' }}>Range</span>
                <span style={{ textAlign: 'right' }}>Count</span>
                <span style={{ textAlign: 'right' }}>Value</span>
              </div>

              {filteredLocalityRows.length > 0
                ? filteredLocalityRows.map((row, idx) => {
                    const pct        = maxFilteredPrice === minFilteredPrice ? 50
                      : ((row.avg_price - minFilteredPrice) / (maxFilteredPrice - minFilteredPrice)) * 100
                    const valueLabel = pct < 33
                      ? { text: '● Value', color: '#22c55e' }
                      : pct < 66
                      ? { text: '● Mid',   color: '#f59e0b' }
                      : { text: '▲ High',  color: '#e24b4a' }

                    return (
                      <div
                        key={row.locality}
                        onClick={() => navigate(`/app?location=${encodeURIComponent(row.locality)}`)}
                        style={{
                          display:             'grid',
                          gridTemplateColumns: '1fr 90px 100px 70px 80px',
                          padding:             '10px 12px',
                          borderBottom:        idx < filteredLocalityRows.length - 1
                            ? '1px solid var(--border)' : 'none',
                          fontSize:   '13px',
                          cursor:     'pointer',
                          transition: 'background 0.15s',
                          borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover, rgba(255,255,255,0.04))'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                          {row.locality}
                        </span>
                        <span style={{ textAlign: 'right', color: '#f5a623', fontWeight: '600' }}>
                          {formatPrice(row.avg_price)}
                        </span>
                        <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '11px' }}>
                          {formatPrice(row.min_price)}–{formatPrice(row.max_price)}
                        </span>
                        <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {row.listing_count}
                        </span>
                        <span style={{
                          textAlign:  'right',
                          fontSize:   '11px',
                          fontWeight: '500',
                          color:      valueLabel.color,
                        }}>
                          {valueLabel.text}
                        </span>
                      </div>
                    )
                  })
                : (
                  <div style={{
                    textAlign: 'center',
                    padding:   '30px',
                    color:     'var(--text-muted)',
                    fontSize:  '13px',
                  }}>
                    Not enough data for {selectedBhk} yet
                  </div>
                )
              }
            </Card>

            {/* ── Best value + Most active ──────────────────────────────── */}
            <div style={{
              display:             'grid',
              gridTemplateColumns: '1fr 1fr',
              gap:                 '16px',
            }}
              className="insights-two-col"
            >
              {/* Best value localities */}
              <Card accentColor="#22c55e" title="Best value for 2 BHK">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(data.best_value_localities ?? []).map((loc, idx) => (
                    <div
                      key={loc.locality}
                      onClick={() => navigate(`/app?location=${encodeURIComponent(loc.locality)}&bhk=2 BHK`)}
                      style={{
                        display:        'flex',
                        alignItems:     'center',
                        justifyContent: 'space-between',
                        padding:        '8px 10px',
                        background:     'var(--bg-secondary)',
                        borderRadius:   '8px',
                        cursor:         'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize:   '11px',
                          fontWeight: '700',
                          color:      idx === 0 ? '#f5a623' : 'var(--text-muted)',
                          minWidth:   '18px',
                        }}>
                          #{idx + 1}
                        </span>
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                          {loc.locality}
                        </span>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#22c55e' }}>
                        {formatPrice(loc.avg_price)}
                      </span>
                    </div>
                  ))}
                  {!(data.best_value_localities?.length) && (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      Not enough data yet
                    </div>
                  )}
                </div>
              </Card>

              {/* Most active localities */}
              <Card accentColor="#229ed9" title="Most active today">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(data.most_active_localities ?? []).map((loc, idx) => (
                    <div
                      key={loc.locality}
                      onClick={() => navigate(`/app?location=${encodeURIComponent(loc.locality)}`)}
                      style={{
                        display:        'flex',
                        alignItems:     'center',
                        justifyContent: 'space-between',
                        padding:        '8px 10px',
                        background:     'var(--bg-secondary)',
                        borderRadius:   '8px',
                        cursor:         'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize:   '11px',
                          fontWeight: '700',
                          color:      idx === 0 ? '#229ed9' : 'var(--text-muted)',
                          minWidth:   '18px',
                        }}>
                          #{idx + 1}
                        </span>
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                          {loc.locality}
                        </span>
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: '500', color: '#229ed9' }}>
                        {loc.new_listings} new
                      </span>
                    </div>
                  ))}
                  {!(data.most_active_localities?.length) && (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No new listings in last 24h
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div style={{
              textAlign:     'center',
              fontSize:      '12px',
              color:         'var(--text-muted)',
              paddingBottom: '16px',
            }}>
              Data refreshes every 30 minutes · Based on active listings from NoBroker, Housing.com, Telegram and Reddit
            </div>

          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 600px) {
          .insights-two-col {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}

/* ── Reusable card shell ──────────────────────────────────────────────────── */
function Card({ accentColor = '#f5a623', title, headerRight, children }) {
  return (
    <div style={{
      background:    'var(--bg-card)',
      backdropFilter:'blur(16px)',
      border:        '1px solid var(--border)',
      borderRadius:  '16px',
      padding:       '20px',
      position:      'relative',
      overflow:      'hidden',
    }}>
      {/* top accent line */}
      <div style={{
        position:   'absolute',
        top: 0, left: 0, right: 0,
        height:     '1px',
        background: `linear-gradient(to right, transparent, ${accentColor}, transparent)`,
      }} />

      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   '16px',
        flexWrap:       'wrap',
        gap:            '10px',
      }}>
        <h3 style={{
          margin:     0,
          fontSize:   '14px',
          fontWeight: '600',
          color:      'var(--text-primary)',
        }}>
          {title}
        </h3>
        {headerRight}
      </div>

      {children}
    </div>
  )
}
