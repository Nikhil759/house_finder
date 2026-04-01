import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';

// ── Static data ───────────────────────────────────────────────────────────────
const TIERS = [
  {
    id: '01',
    label: 'Premium',
    icon: '★',
    localities: [
      { name: 'Indiranagar', rent: '₹72,400', slug: 'indiranagar' },
      { name: 'Koramangala', rent: '₹68,100', slug: 'koramangala' },
    ],
  },
  {
    id: '02',
    label: 'Mid-Range',
    icon: '↑',
    localities: [
      { name: 'HSR Layout', rent: '₹45,200', slug: 'hsr-layout' },
      { name: 'Whitefield', rent: '₹42,800', slug: 'whitefield' },
    ],
  },
  {
    id: '03',
    label: 'Affordable',
    icon: '◎',
    localities: [
      { name: 'Electronic City', rent: '₹22,500', slug: 'electronic-city' },
      { name: 'Kengeri', rent: '₹18,200', slug: 'kengeri' },
    ],
  },
];

const DEPOSITS = [
  { config: '1 BHK', multiplier: '4.2×', range: '₹72k – ₹1.2L' },
  { config: '2 BHK', multiplier: '5.8×', range: '₹2.4L – ₹4.0L' },
  { config: '3 BHK', multiplier: '6.5×', range: '₹4.5L – ₹7.2L' },
];

const SENTIMENT_TOPICS = [
  { label: 'Rent Hike', pct: 84 },
  { label: 'Vibe / Lifestyle', pct: 62 },
  { label: 'Owner Issues', pct: 41 },
  { label: 'Brokerage', pct: 29 },
];

const FEED_TABS = ['All', 'Reddit', 'Telegram', 'News'];

const FEED_ITEMS = [
  {
    id: 1,
    source: 'Reddit',
    channel: 'r/bangalore',
    timeAgo: '4h ago',
    title: 'Unreal rent jump in HSR Sector 2',
    body: 'My landlord just asked for a 40% hike. Is this even legal? Thinking of moving to Electronic City but the commute will kill me.',
    tags: ['#RentHike', '#HSRLayout'],
  },
  {
    id: 2,
    source: 'Telegram',
    channel: 'BLR_Rents',
    timeAgo: '6h ago',
    title: 'Direct owner flat in Indiranagar 100ft Rd',
    body: 'Beautiful 2BHK available for 65k. No brokerage. Looking for bachelors or small families who work nearby. Immediate move in.',
    tags: ['#NoBroker', '#Indiranagar'],
  },
  {
    id: 3,
    source: 'News',
    channel: 'TOI Tech',
    timeAgo: '12h ago',
    title: 'Tech corridor rental market sees cooling trend',
    body: 'Recent data suggests a marginal slowdown in rental appreciation across Whitefield and Sarjapur as hybrid work becomes permanent.',
    tags: ['#MarketAnalysis', '#TechHubs'],
  },
];

// ── Shared style objects ──────────────────────────────────────────────────────
const s = {
  page: {
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    minHeight: '100vh',
    paddingBottom: 100,
  },
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    color: 'var(--color-amber)',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  h2: {
    fontWeight: 300,
    fontSize: 20,
    letterSpacing: '-0.02em',
    marginBottom: 20,
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
};

// ── Sub-components ────────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      background: 'var(--color-bg-card)',
      color: 'var(--color-text-muted)',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
      padding: '3px 8px',
    }}>
      {source}
    </span>
  );
}

function FeedCard({ item }) {
  return (
    <article style={{ ...s.card, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <SourceBadge source={item.source} />
        <span style={{ ...s.monoSmall }}>{item.channel}</span>
        <span style={{ ...s.monoSmall, marginLeft: 'auto' }}>{item.timeAgo}</span>
      </div>
      <h3 style={{ fontWeight: 300, fontSize: 15, lineHeight: 1.4, marginBottom: 8 }}>
        {item.title}
      </h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 10 }}>
        {item.body}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {item.tags.map(tag => (
          <span key={tag} style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'var(--color-amber)',
            opacity: 0.8,
          }}>
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function Pulse() {
  const [feedTab, setFeedTab] = useState('All');

  const visibleFeed = feedTab === 'All'
    ? FEED_ITEMS
    : FEED_ITEMS.filter(f => f.source === feedTab);

  return (
    <div style={s.page}>

      <AppHeader />

      <div style={{ padding: '24px 16px 0' }}>

        {/* ── PAGE TITLE ── */}
        <h1 style={{
          fontWeight: 300, fontSize: 26, letterSpacing: '-0.025em',
          lineHeight: 1.2, marginBottom: 32,
        }}>
          Live rental intelligence<br />for Bangalore.
        </h1>

        {/* ── RENT BY LOCALITY ── */}
        <section style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <h2 style={{ ...s.h2, marginBottom: 0 }}>Average Rent by Locality</h2>
            <span style={{ ...s.monoSmall }}>Updated 2m ago</span>
          </div>

          {TIERS.map(tier => (
            <div key={tier.id} style={{ marginBottom: 24 }}>
              {/* Tier label */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
                  color: 'var(--color-text-muted)',
                }}>
                  {tier.id}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--color-text-muted)',
                }}>
                  {tier.icon} {tier.label}
                </span>
              </div>

              {/* Locality rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {tier.localities.map(loc => (
                  <Link
                    key={loc.slug}
                    to={`/neighbourhood-pulse/${loc.slug}`}
                    style={{
                      ...s.card,
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      textDecoration: 'none', color: 'inherit',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-card)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-bg-surface)')}
                  >
                    <div>
                      <p style={{ fontWeight: 300, fontSize: 16, marginBottom: 2 }}>{loc.name}</p>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>
                        avg / mo
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500,
                        color: 'var(--color-text-primary)', letterSpacing: '-0.02em',
                      }}>
                        {loc.rent}
                      </span>
                      <span style={{ color: 'var(--color-amber)', fontSize: 14 }}>→</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* ── DEPOSIT BENCHMARKS ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={s.h2}>Security Deposit Benchmarks</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DEPOSITS.map(d => (
              <div key={d.config} style={{
                ...s.card,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <p style={{ ...s.monoSmall, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {d.config} Multiplier
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{d.range}</p>
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 500,
                  color: 'var(--color-amber)', letterSpacing: '-0.03em', lineHeight: 1,
                }}>
                  {d.multiplier}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── MARKET SENTIMENT ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={s.h2}>Market Sentiment</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            Aggregated real-time signals from social feeds and regional news outlets.
          </p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {['All Sources', 'Reddit', 'News'].map(tab => (
              <button key={tab} style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em',
                background: tab === 'All Sources' ? 'var(--color-amber)' : 'var(--color-bg-surface)',
                color: tab === 'All Sources' ? '#1a0a00' : 'var(--color-text-muted)',
                border: tab === 'All Sources' ? 'none' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-pill)', padding: '6px 14px', cursor: 'pointer',
              }}>
                {tab}
              </button>
            ))}
          </div>

          <div style={{ ...s.card }}>
            <p style={{ ...s.eyebrow, marginBottom: 16 }}>Volume by Topic</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {SENTIMENT_TOPICS.map(t => (
                <div key={t.label}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'baseline', marginBottom: 6,
                  }}>
                    <span style={{ ...s.monoSmall, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {t.label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
                      color: 'var(--color-text-primary)',
                    }}>
                      {t.pct}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{
                    height: 3, background: 'var(--color-border)',
                    borderRadius: 'var(--radius-pill)', overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', width: `${t.pct}%`,
                      background: 'var(--color-amber)',
                      borderRadius: 'var(--radius-pill)',
                      opacity: 0.5 + (t.pct / 200),
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SOCIAL FEED ── */}
        <section style={{ marginBottom: 24 }}>
          {/* Feed tab bar */}
          <div style={{
            display: 'flex', gap: 6, marginBottom: 16,
            overflowX: 'auto', scrollbarWidth: 'none',
          }}>
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

          {visibleFeed.length === 0 ? (
            <p style={{ ...s.monoSmall, padding: '24px 0', textAlign: 'center' }}>
              No signals for this source yet.
            </p>
          ) : (
            visibleFeed.map(item => <FeedCard key={item.id} item={item} />)
          )}
        </section>

        {/* ── GENERATE REPORT CTA ── */}
        <button style={{
          width: '100%',
          fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
          textTransform: 'uppercase',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          padding: '14px',
          cursor: 'pointer',
          transition: 'border-color 0.2s, color 0.2s',
        }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--color-amber)';
            e.currentTarget.style.color = 'var(--color-amber)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.color = 'var(--color-text-muted)';
          }}
        >
          ▲ Generate Market Report
        </button>

      </div>

      <BottomNav />
    </div>
  );
}
