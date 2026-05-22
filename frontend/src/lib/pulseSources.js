export const PULSE_SOURCE_LABELS = {
  reddit: 'Reddit',
  news: 'News',
  google_news_rss: 'News',
  citizen_matters: 'Citizen Matters',
  telegram: 'Telegram',
  nestiq: 'NestIQ',
};

export const PULSE_SOURCE_COLORS = {
  reddit: { color: '#F97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.3)' },
  telegram: { color: '#38BDF8', bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.3)' },
  news: { color: '#60A5FA', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)' },
  google_news_rss: { color: '#60A5FA', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)' },
  citizen_matters: { color: '#34D399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.3)' },
};

export const PULSE_LOCALITY_FEED_TABS = ['All', 'Reddit', 'Telegram', 'News', 'Citizen Matters'];

export function pulseSourceLabel(source) {
  return PULSE_SOURCE_LABELS[(source || '').toLowerCase()] || source || 'Unknown';
}

export function pulseSourceColor(source) {
  return PULSE_SOURCE_COLORS[(source || '').toLowerCase()] || null;
}

export function matchesPulseLocalityTab(post, tab) {
  if (tab === 'All') return true;
  const src = (post.source || '').toLowerCase();
  if (tab === 'Reddit') return src === 'reddit';
  if (tab === 'Telegram') return src === 'telegram';
  if (tab === 'News') return src === 'news' || src === 'google_news_rss';
  if (tab === 'Citizen Matters') return src === 'citizen_matters';
  return true;
}
