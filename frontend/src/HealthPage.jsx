import { useState, useEffect, useCallback } from "react";
import { useTheme } from "./ThemeContext";
import Navbar from "./components/Navbar";

const API_BASE = import.meta.env.VITE_API_URL || "";

const SOURCE_META = {
  reddit:   { label: "Reddit",      icon: "🟠", ttlHours: 7,  refreshLabel: "Cron job every 6h (local machine)" },
  telegram: { label: "Telegram",    icon: "✈️",  ttlHours: 4,  refreshLabel: "Background worker every 3h" },
  nobroker: { label: "NoBroker",    icon: "🔴", ttlHours: 4,  refreshLabel: "Background worker every 3h" },
  housing:  { label: "Housing.com", icon: "🏠", ttlHours: 4,  refreshLabel: "Background worker every 3h" },
};

const FEED_SOURCE_META = {
  news:   { label: "News (NewsAPI)",          icon: "📰", refreshLabel: "GitHub Actions every 6h" },
  reddit: { label: "Reddit Discussions",      icon: "💬", refreshLabel: "Local cron every 6h" },
};

function statusFor(source, info) {
  if (!info || info.count === 0) return "dead";
  const meta = SOURCE_META[source];
  if (!meta) return "ok";
  const ttlMinutes = meta.ttlHours * 60;
  const age = info.newest_age_minutes;
  if (age == null) return "dead";
  if (age > ttlMinutes * 0.75) return "stale";
  return "ok";
}

const STATUS_CONFIG = {
  ok:    { dot: "#22c55e", label: "Healthy",  bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)" },
  stale: { dot: "#f59e0b", label: "Stale",    bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)" },
  dead:  { dot: "#ef4444", label: "No data",  bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)" },
};

function formatAge(minutes) {
  if (minutes == null) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function SourceCard({ sourceId, info, isDark }) {
  const meta = SOURCE_META[sourceId] || { label: sourceId, icon: "●", ttlHours: 4, refreshLabel: "" };
  const status = statusFor(sourceId, info);
  const cfg = STATUS_CONFIG[status];

  return (
    <div style={{
      background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
      border: `1px solid ${cfg.border}`,
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      alignItems: "center",
      gap: 20,
    }}>
      <div style={{ fontSize: 28, lineHeight: 1 }}>{meta.icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{meta.label}</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: cfg.bg, border: `1px solid ${cfg.border}`,
            borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 500,
            color: cfg.dot,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot, display: "inline-block" }} />
            {cfg.label}
          </span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 13, opacity: 0.7 }}>
          <span>
            <strong style={{ opacity: 1 }}>{(info?.count ?? 0).toLocaleString()}</strong> active
          </span>
          {(info?.stale_count > 0 || info?.expired_count > 0) && (
            <span style={{ color: "#f59e0b" }}>
              {info?.stale_count > 0 && (
                <><strong style={{ opacity: 1 }}>{info.stale_count.toLocaleString()}</strong> stale</>
              )}
              {info?.stale_count > 0 && info?.expired_count > 0 && " · "}
              {info?.expired_count > 0 && (
                <><strong style={{ opacity: 1 }}>{info.expired_count.toLocaleString()}</strong> expired</>
              )}
            </span>
          )}
          {info?.total_count != null && (
            <span style={{ opacity: 0.55 }}>
              <strong style={{ opacity: 1 }}>{(info.total_count).toLocaleString()}</strong> total in DB
            </span>
          )}
          {info?.newest_age_minutes != null && (
            <span>Last fetched: <strong style={{ opacity: 1 }}>{formatAge(info.newest_age_minutes)}</strong></span>
          )}
          {info?.oldest_age_minutes != null && (
            <span>Oldest: <strong style={{ opacity: 1 }}>{formatAge(info.oldest_age_minutes)}</strong></span>
          )}
          <span>TTL: {meta.ttlHours}h</span>
        </div>

        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.45 }}>{meta.refreshLabel}</div>
      </div>
    </div>
  );
}

function LocalityTable({ byLocality, isDark }) {
  const entries = Object.entries(byLocality || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  if (!entries.length) return null;

  return (
    <div style={{
      background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
      borderRadius: 12,
      overflow: "hidden",
    }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`, fontWeight: 600, fontSize: 14 }}>
        Top localities by listing count
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {entries.map(([loc, count]) => (
          <div key={loc} style={{
            padding: "10px 20px",
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}`,
            display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13,
          }}>
            <span style={{ opacity: 0.8 }}>{loc}</span>
            <span style={{ fontWeight: 600, color: "#f5a623" }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedSourceCard({ sourceId, info, isDark }) {
  const meta = FEED_SOURCE_META[sourceId] || { label: sourceId, icon: "●", refreshLabel: "" };
  const hasData = info && info.last_24h > 0;
  const untaggedRatio = info ? info.untagged / Math.max(info.total, 1) : 0;
  const status = !info || info.total === 0 ? "dead" : !hasData ? "stale" : "ok";
  const cfg = STATUS_CONFIG[status];

  return (
    <div style={{
      background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
      border: `1px solid ${cfg.border}`,
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      alignItems: "center",
      gap: 20,
    }}>
      <div style={{ fontSize: 28, lineHeight: 1 }}>{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{meta.label}</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: cfg.bg, border: `1px solid ${cfg.border}`,
            borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 500,
            color: cfg.dot,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot, display: "inline-block" }} />
            {cfg.label}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 13, opacity: 0.7 }}>
          <span><strong style={{ opacity: 1 }}>{(info?.total ?? 0).toLocaleString()}</strong> total posts</span>
          <span><strong style={{ opacity: 1 }}>{(info?.last_24h ?? 0).toLocaleString()}</strong> in last 24h</span>
          {info?.untagged > 0 && (
            <span style={{ color: "#f59e0b" }}>
              <strong style={{ opacity: 1 }}>{info.untagged}</strong> untagged
            </span>
          )}
          {info?.newest_age_minutes != null && (
            <span>Last fetched: <strong style={{ opacity: 1 }}>{formatAge(info.newest_age_minutes)}</strong></span>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.45 }}>{meta.refreshLabel}</div>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [data, setData] = useState(null);
  const [feedData, setFeedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [listingsRes, feedRes] = await Promise.all([
        fetch(`${API_BASE}/api/ingestion/status`),
        fetch(`${API_BASE}/api/locality-feed/status`),
      ]);
      if (!listingsRes.ok) throw new Error(`Listings API HTTP ${listingsRes.status}`);
      const json = await listingsRes.json();
      setData(json);
      if (feedRes.ok) {
        const feedJson = await feedRes.json();
        setFeedData(feedJson);
      }
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const bg      = isDark ? "#0d0d14" : "#f8f7f4";
  const text     = isDark ? "#e8e4d8" : "#1a1a2e";
  const muted    = isDark ? "rgba(232,228,216,0.45)" : "rgba(26,26,46,0.5)";
  const cardBg   = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
  const cardBord = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  const bySource = data?.by_source || {};
  const allSourceIds = ["reddit", "telegram", "nobroker", "housing"];
  const totalAllSources = data?.total_listings_all ?? null;

  const overallStatus = allSourceIds.every(s => statusFor(s, bySource[s]) === "ok")
    ? "ok"
    : allSourceIds.some(s => statusFor(s, bySource[s]) === "dead")
    ? "dead"
    : "stale";

  return (
    <div style={{ minHeight: "100vh", background: bg, color: text, fontFamily: "monospace" }}>
      <Navbar subtitle="System Health" />

      {/* Refresh bar */}
      <div style={{
        borderBottom: `1px solid ${cardBord}`,
        padding: "10px 32px",
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12,
        background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
      }}>
        {lastRefreshed && (
          <span style={{ fontSize: 11, color: muted }}>
            Refreshed {lastRefreshed.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={fetchStatus}
          disabled={loading}
          style={{
            background: "transparent",
            border: `1px solid ${cardBord}`,
            borderRadius: 6,
            color: text,
            padding: "6px 14px",
            fontSize: 12,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? "⟳ Loading..." : "⟳ Refresh"}
        </button>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>

        {/* Summary bar */}
        <div style={{
          background: cardBg,
          border: `1px solid ${STATUS_CONFIG[overallStatus].border}`,
          borderRadius: 12,
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px" }}>
              {loading ? "—" : (data?.total_listings ?? 0).toLocaleString()}
              <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.6, marginLeft: 8 }}>active listings</span>
            </div>
            {!loading && totalAllSources != null && totalAllSources !== data?.total_listings && (
              <div style={{ fontSize: 13, color: muted, marginTop: 2 }}>
                <strong style={{ color: text, opacity: 0.7 }}>{totalAllSources.toLocaleString()}</strong>
                <span style={{ marginLeft: 4 }}>total in DB (incl. stale &amp; expired)</span>
              </div>
            )}
            <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>
              across {allSourceIds.length} sources · expires automatically per-source TTL
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%",
              background: STATUS_CONFIG[overallStatus].dot,
              display: "inline-block",
            }} />
            <span style={{ fontSize: 13, color: STATUS_CONFIG[overallStatus].dot, fontWeight: 600 }}>
              {overallStatus === "ok" ? "All systems operational" :
               overallStatus === "stale" ? "Some sources are stale" :
               "One or more sources have no data"}
            </span>
          </div>
        </div>

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#ef4444",
          }}>
            Failed to load status: {error}
          </div>
        )}

        {/* Source cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
          {allSourceIds.map(src => (
            <SourceCard
              key={src}
              sourceId={src}
              info={bySource[src]}
              isDark={isDark}
            />
          ))}
        </div>

        {/* Locality breakdown */}
        {data?.by_locality && <LocalityTable byLocality={data.by_locality} isDark={isDark} />}

        {/* Locality Feed section */}
        <div style={{ marginTop: 40 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
            textTransform: "uppercase", opacity: 0.45, marginBottom: 16,
          }}>
            Locality Feed
          </div>

          {/* Summary */}
          <div style={{
            background: cardBg, border: `1px solid ${cardBord}`,
            borderRadius: 12, padding: "16px 24px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 12, flexWrap: "wrap", gap: 12,
          }}>
            <div>
              <span style={{ fontSize: 24, fontWeight: 700 }}>
                {loading ? "—" : (feedData?.total_posts ?? 0).toLocaleString()}
              </span>
              <span style={{ fontSize: 13, opacity: 0.6, marginLeft: 8 }}>total feed posts</span>
            </div>
            <div style={{ fontSize: 12, color: muted }}>
              news articles + Reddit discussions · tagged by Gemini
            </div>
          </div>

          {/* Per-source cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            {Object.keys(FEED_SOURCE_META).map(src => (
              <FeedSourceCard
                key={src}
                sourceId={src}
                info={feedData?.by_source?.[src]}
                isDark={isDark}
              />
            ))}
          </div>

          {/* Top localities in last 24h */}
          {feedData?.by_locality_24h && Object.keys(feedData.by_locality_24h).length > 0 && (
            <div style={{
              background: cardBg, border: `1px solid ${cardBord}`,
              borderRadius: 12, overflow: "hidden",
            }}>
              <div style={{
                padding: "14px 20px",
                borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
                fontWeight: 600, fontSize: 14,
              }}>
                Feed coverage — last 24h by locality
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {Object.entries(feedData.by_locality_24h).map(([loc, count]) => (
                  <div key={loc} style={{
                    padding: "10px 20px",
                    borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13,
                  }}>
                    <span style={{ opacity: 0.8 }}>{loc}</span>
                    <span style={{ fontWeight: 600, color: "#7c6af5" }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
