import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';

// ── Static data keyed by slug ─────────────────────────────────────────────────
const LOCALITY_DB = {
  koramangala: {
    name: 'Koramangala',
    listings: 58,
    updatedAgo: '2 days ago',
    stats: [
      { label: 'Avg 2BHK Rent', value: '₹38k' },
      { label: 'Total Listings', value: '58' },
      { label: 'Deposit Mult.', value: '4.8×' },
      { label: 'Price Trend', value: '+4%' },
    ],
    depth: [
      { config: '1 BHK', range: '₹18k – ₹24k', low: 18, high: 24, max: 80 },
      { config: '2 BHK', range: '₹35k – ₹42k', low: 35, high: 42, max: 80 },
      { config: '3 BHK', range: '₹55k – ₹72k', low: 55, high: 72, max: 80 },
    ],
    insights: [
      { label: 'Rent', count: 142 },
      { label: 'Vibe', count: 98 },
      { label: 'Commute', count: 104 },
      { label: 'Safety', count: 56 },
    ],
    feed: [
      {
        id: 1, source: 'Reddit', channel: 'r/bangalore', timeAgo: '4h ago',
        title: 'The "Koramangala Tax" is becoming unbearable for single BHKs',
        body: 'Owners are now asking for 50k deposit for tiny matchbox rooms in 4th block. Better to look at HSR or Indiranagar...',
      },
      {
        id: 2, source: 'News', channel: 'News Cluster', timeAgo: '1d ago',
        title: 'Sony World Junction redesign expected to ease commute by Q3',
        body: 'Traffic police reports suggest 15% improvement in peak hour throughput following new lane markings.',
      },
      {
        id: 3, source: 'Telegram', channel: 'Telegram Community', timeAgo: '2h ago',
        title: 'Water shortage in 1st Block: tankers delayed by 24 hours',
        body: 'Multiple reports of dry taps across several standalone buildings. High engagement on this thread.',
      },
    ],
  },
  indiranagar: {
    name: 'Indiranagar',
    listings: 74,
    updatedAgo: '1 hour ago',
    stats: [
      { label: 'Avg 2BHK Rent', value: '₹52k' },
      { label: 'Total Listings', value: '74' },
      { label: 'Deposit Mult.', value: '5.2×' },
      { label: 'Price Trend', value: '+2.8%' },
    ],
    depth: [
      { config: '1 BHK', range: '₹22k – ₹30k', low: 22, high: 30, max: 80 },
      { config: '2 BHK', range: '₹45k – ₹58k', low: 45, high: 58, max: 80 },
      { config: '3 BHK', range: '₹70k – ₹95k', low: 70, high: 95, max: 100 },
    ],
    insights: [
      { label: 'Rent', count: 188 },
      { label: 'Vibe', count: 210 },
      { label: 'Commute', count: 92 },
      { label: 'Safety', count: 76 },
    ],
    feed: [
      {
        id: 1, source: 'Reddit', channel: 'r/bangalore', timeAgo: '2h ago',
        title: 'Direct owner flat in 100ft Rd — 65k no broker',
        body: 'Beautiful 2BHK with attached parking. Looking for working professionals. Immediate move-in available.',
      },
      {
        id: 2, source: 'Telegram', channel: 'BLR_Rents', timeAgo: '5h ago',
        title: 'Is Indiranagar worth the premium in 2026?',
        body: 'Quality of life remains excellent but rents have outpaced salary growth. Discussion thread with 240+ replies.',
      },
    ],
  },
  'hsr-layout': {
    name: 'HSR Layout',
    listings: 91,
    updatedAgo: '30 minutes ago',
    stats: [
      { label: 'Avg 2BHK Rent', value: '₹34k' },
      { label: 'Total Listings', value: '91' },
      { label: 'Deposit Mult.', value: '4.4×' },
      { label: 'Price Trend', value: '+1.9%' },
    ],
    depth: [
      { config: '1 BHK', range: '₹14k – ₹20k', low: 14, high: 20, max: 50 },
      { config: '2 BHK', range: '₹28k – ₹38k', low: 28, high: 38, max: 50 },
      { config: '3 BHK', range: '₹45k – ₹60k', low: 45, high: 60, max: 80 },
    ],
    insights: [
      { label: 'Rent', count: 220 },
      { label: 'Vibe', count: 140 },
      { label: 'Commute', count: 165 },
      { label: 'Safety', count: 112 },
    ],
    feed: [
      {
        id: 1, source: 'Reddit', channel: 'r/bangalore', timeAgo: '1h ago',
        title: 'HSR Sector 2 vs Sector 7 — where should I rent?',
        body: 'Sector 2 is closer to the junction but noisier. Sector 7 is quieter with better roads. Both similar rent bands.',
      },
      {
        id: 2, source: 'News', channel: 'Deccan Herald', timeAgo: '8h ago',
        title: 'BBMP approves new parks in HSR Layout Sectors 4 & 5',
        body: 'Green cover addition expected to improve liveability scores. Residents anticipate modest rent bump post-completion.',
      },
    ],
  },
};

const FEED_TABS = ['All', 'Reddit', 'Telegram', 'News'];

// ── Shared styles ─────────────────────────────────────────────────────────────
const s = {
  page: {
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    minHeight: '100vh',
    paddingBottom: 100,
  },
  card: {
    background: 'var(--color-bg-surface)',
    borderRadius: 'var(--radius-card)',
    padding: '16px 18px',
  },
  monoSmall: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.06em',
    color: 'var(--color-text-muted)',
  },
  h2: {
    fontWeight: 300,
    fontSize: 18,
    letterSpacing: '-0.02em',
    marginBottom: 16,
  },
};

function SourceBadge({ source }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
      textTransform: 'uppercase', background: 'var(--color-bg-card)',
      color: 'var(--color-text-muted)', border: '1px solid var(--color-border)',
      borderRadius: 4, padding: '3px 8px',
    }}>
      {source}
    </span>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function PulseLocality() {
  const { locality } = useParams();
  const [feedTab, setFeedTab] = useState('All');

  const data = LOCALITY_DB[locality];

  // Graceful fallback for unknown slugs
  if (!data) {
    return (
      <div style={{ ...s.page, padding: '80px 24px', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Locality not found.
        </p>
        <Link to="/locality-guide" style={{ color: 'var(--color-amber)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          ← Back to Pulse
        </Link>
        <BottomNav />
      </div>
    );
  }

  const maxInsight = Math.max(...data.insights.map(i => i.count));

  const visibleFeed = feedTab === 'All'
    ? data.feed
    : data.feed.filter(f => f.source === feedTab);

  return (
    <div style={s.page}>

      <AppHeader backTo />

      <div style={{ padding: '24px 16px 0' }}>

        {/* ── TITLE ── */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontWeight: 300, fontSize: 30, letterSpacing: '-0.025em', marginBottom: 6 }}>
            {data.name}
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
            {data.listings} active listings · Updated {data.updatedAgo}
          </p>
        </div>

        {/* ── STATS ROW ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8, marginBottom: 32,
        }}>
          {data.stats.map(stat => (
            <div key={stat.label} style={s.card}>
              <p style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                {stat.label}
              </p>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500,
                color: 'var(--color-text-primary)', letterSpacing: '-0.02em',
              }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── MARKET DEPTH ── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={s.h2}>Market Depth by Configuration</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.depth.map(d => (
              <div key={d.config} style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {d.config}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-text-primary)' }}>
                    {d.range}
                  </span>
                </div>
                {/* Range bar */}
                <div style={{
                  height: 4, background: 'var(--color-border)',
                  borderRadius: 'var(--radius-pill)', position: 'relative', overflow: 'visible',
                }}>
                  <div style={{
                    position: 'absolute',
                    left: `${(d.low / d.max) * 100}%`,
                    width: `${((d.high - d.low) / d.max) * 100}%`,
                    height: '100%',
                    background: 'var(--color-amber)',
                    borderRadius: 'var(--radius-pill)',
                    opacity: 0.7,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── INSIGHT FREQUENCY ── */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={s.h2}>Insight Frequency</h2>
          <div style={{ ...s.card }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {data.insights.map(ins => (
                <div key={ins.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {ins.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {ins.count}
                    </span>
                  </div>
                  <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(ins.count / maxInsight) * 100}%`,
                      background: 'var(--color-amber)',
                      borderRadius: 'var(--radius-pill)',
                      opacity: 0.5 + (ins.count / maxInsight) * 0.5,
                    }} />
                  </div>
                </div>
              ))}
            </div>
            <p style={{ ...s.monoSmall, marginTop: 14, fontSize: 10, opacity: 0.6 }}>
              Powered by Gemini ✦
            </p>
          </div>
        </section>

        {/* ── SIGNALS FEED ── */}
        <section style={{ marginBottom: 24 }}>
          <h2 style={s.h2}>Signals & Discussions</h2>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {FEED_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setFeedTab(tab)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                  background: feedTab === tab ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                  color: feedTab === tab ? '#1a0a00' : 'var(--color-text-muted)',
                  border: feedTab === tab ? 'none' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-pill)', padding: '6px 14px',
                  cursor: 'pointer', transition: 'background 0.2s, color 0.2s',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleFeed.length === 0 ? (
              <p style={{ ...s.monoSmall, padding: '24px 0', textAlign: 'center' }}>
                No signals for this source yet.
              </p>
            ) : (
              visibleFeed.map(item => (
                <article key={item.id} style={s.card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <SourceBadge source={item.source} />
                    <span style={s.monoSmall}>{item.channel}</span>
                    <span style={{ ...s.monoSmall, marginLeft: 'auto' }}>{item.timeAgo}</span>
                  </div>
                  <h3 style={{ fontWeight: 300, fontSize: 15, lineHeight: 1.4, marginBottom: 8 }}>
                    {item.title}
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                    {item.body}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>

      </div>

      <BottomNav />
    </div>
  );
}
