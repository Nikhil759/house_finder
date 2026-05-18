import { useState, useEffect, useCallback } from "react";
import { useTheme } from "./ThemeContext";
import Navbar from "./components/Navbar";

const API_BASE = import.meta.env.VITE_API_URL || "";

const SOURCE_META = {
  reddit:    { label: "Reddit",      icon: "🟠", ttlHours: 7,  refreshLabel: "Cron job every 6h (local machine)" },
  telegram:  { label: "Telegram",    icon: "✈️",  ttlHours: 4,  refreshLabel: "Background worker every 3h" },
  nobroker:  { label: "NoBroker",    icon: "🔴", ttlHours: 4,  refreshLabel: "Background worker every 3h" },
  housing:   { label: "Housing.com", icon: "🏠", ttlHours: 4,  refreshLabel: "Background worker every 3h" },
  '99acres': { label: "99acres",     icon: "🏷️", ttlHours: 4,  refreshLabel: "Railway cron every 3h" },
};

const FEED_SOURCE_META = {
  news:   { label: "News (NewsAPI)",          icon: "📰", refreshLabel: "GitHub Actions every 6h" },
  reddit: { label: "Reddit Discussions",      icon: "💬", refreshLabel: "Local cron every 6h" },
};

const FEED_INGEST_META = {
  news:                { label: "News API" },
  reddit_discussions:  { label: "Reddit Discussions" },
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
  ok:       { dot: "#22c55e", label: "Healthy",  bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)" },
  stale:    { dot: "#f59e0b", label: "Stale",    bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)" },
  dead:     { dot: "#ef4444", label: "No data",  bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)" },
  success:  { dot: "#22c55e", label: "Success",  bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)" },
  failed:   { dot: "#ef4444", label: "Failed",   bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)" },
  running:  { dot: "#3b82f6", label: "Running",  bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.25)" },
  partial:  { dot: "#f59e0b", label: "Partial",  bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)" },
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

function formatDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s}s`;
}

function relativeTime(isoStr) {
  if (!isoStr) return "—";
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function RunStatusBadge({ status, totalFetched }) {
  const isZeroFetch = (status === "success" || status === "completed") && totalFetched === 0;
  const effectiveStatus = isZeroFetch ? "partial" : status;
  const key = (effectiveStatus === "completed" || effectiveStatus === "success") ? "success" : effectiveStatus === "running" ? "running" : effectiveStatus === "partial" ? "partial" : "failed";
  const cfg = STATUS_CONFIG[key] || STATUS_CONFIG.dead;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 500, color: cfg.dot,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.dot, display: "inline-block" }} />
      {effectiveStatus || "unknown"}
    </span>
  );
}

function RunDotsLegend({ isDark }) {
  const muted = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const items = [
    { color: STATUS_CONFIG.success.dot, label: "Success" },
    { color: STATUS_CONFIG.partial.dot,  label: "Partial (some errors / 0 fetched)" },
    { color: STATUS_CONFIG.failed.dot,   label: "Failed" },
    { color: STATUS_CONFIG.running.dot,  label: "Running" },
    { color: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)", label: "No run", border: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 16 }}>
      {items.map(({ color, label, border }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            width: 9, height: 9, borderRadius: "50%",
            background: color,
            border: border ? `1px solid ${border}` : "none",
            flexShrink: 0, display: "inline-block",
          }} />
          <span style={{ fontSize: 11, fontFamily: "monospace", color: muted }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function RunTooltip({ run, pos, isDark }) {
  if (!run) return null;
  const isIngestion = "total_fetched" in run;
  const isZeroFetch = (run.status === "success" || run.status === "completed") && run.total_fetched === 0;
  const statusKey = isZeroFetch ? "partial"
    : (run.status === "completed" || run.status === "success") ? "success"
    : run.status === "failed"  ? "failed"
    : run.status === "running" ? "running"
    : run.status === "partial" ? "partial"
    : "failed";
  const statusColor = STATUS_CONFIG[statusKey]?.dot ?? "#f59e0b";
  const bg  = isDark ? "#1a1a1a" : "#ffffff";
  const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const muted = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";

  const rows = isIngestion ? [
    ["Fetched",  run.total_fetched  ?? "—"],
    ["New",      run.total_new      ?? "—", run.total_new > 0 ? "#22c55e" : undefined],
    ["Updated",  run.total_updated  ?? "—"],
    ["Stale",    run.total_stale    ?? "—", run.total_stale > 0 ? "#f59e0b" : undefined],
    ["Errors",   run.total_errors   ?? 0,   run.total_errors > 0 ? "#ef4444" : undefined],
  ] : [
    ["Processed", run.records_processed ?? "—"],
    ["Failed",    run.records_failed    ?? 0, run.records_failed > 0 ? "#ef4444" : undefined],
    ["Gemini",    run.gemini_calls      ?? "—"],
    ["Fallback",  run.gemini_fallback_count ?? "—"],
  ];

  const tooltipWidth = 200;
  const viewportW = window.innerWidth;
  const left = Math.min(pos.x + 14, viewportW - tooltipWidth - 12);

  return (
    <div style={{
      position: "fixed",
      left,
      top: pos.y - 8,
      transform: pos.y > window.innerHeight * 0.6 ? "translateY(-100%)" : undefined,
      zIndex: 9999,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: "10px 14px",
      width: tooltipWidth,
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
      fontFamily: "monospace",
      fontSize: 12,
      pointerEvents: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, color: statusColor, textTransform: "capitalize" }}>
          {run.status}
        </span>
        <span style={{ marginLeft: "auto", color: muted, fontSize: 11 }}>
          {relativeTime(run.started_at)}
        </span>
      </div>
      <div style={{ color: muted, fontSize: 11, marginBottom: 8 }}>
        Duration: {formatDuration(run.duration_ms)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map(([label, val, color]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: muted }}>{label}</span>
            <span style={{ fontWeight: 600, color: color || "inherit" }}>{val}</span>
          </div>
        ))}
      </div>
      {run.error_message && (
        <div style={{
          marginTop: 8, paddingTop: 8,
          borderTop: `1px solid ${border}`,
          color: "#ef4444", fontSize: 11,
          wordBreak: "break-word", maxWidth: 240,
        }}>
          {run.error_message}
        </div>
      )}
    </div>
  );
}

function RunDots({ runs, label, isDark }) {
  // oldest on left, newest on right; empty slots pad the left
  const reversed = [...runs].reverse();
  const offset = 5 - runs.length;
  const slots = Array.from({ length: 5 }, (_, i) => i >= offset ? reversed[i - offset] : null);
  const mutedBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const [tooltip, setTooltip] = useState({ run: null, pos: { x: 0, y: 0 } });

  const show = (run, x, y) => setTooltip({ run, pos: { x, y } });
  const hide = () => setTooltip({ run: null, pos: { x: 0, y: 0 } });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{
        fontFamily: "monospace", fontSize: 12, minWidth: 90,
        opacity: 0.7, letterSpacing: "0.02em",
      }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        {slots.map((run, i) => {
          const isZeroFetch = (run?.status === "success" || run?.status === "completed") && run?.total_fetched === 0;
          const statusKey = isZeroFetch ? "partial"
            : (run?.status === "completed" || run?.status === "success") ? "success"
            : run?.status === "failed"  ? "failed"
            : run?.status === "running" ? "running"
            : run?.status === "partial" ? "partial"
            : null;
          const color = !run ? (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)")
            : STATUS_CONFIG[statusKey]?.dot ?? "#f59e0b";
          return (
            <span
              key={i}
              onMouseEnter={run ? (e) => show(run, e.clientX, e.clientY) : undefined}
              onMouseMove={run ? (e) => show(run, e.clientX, e.clientY) : undefined}
              onMouseLeave={run ? hide : undefined}
              onTouchStart={run ? (e) => {
                e.preventDefault();
                const t = e.touches[0];
                show(run, t.clientX, t.clientY);
              } : undefined}
              onTouchEnd={run ? hide : undefined}
              style={{
                width: 11, height: 11, borderRadius: "50%",
                background: color,
                border: run ? "none" : `1px solid ${mutedBorder}`,
                display: "inline-block",
                flexShrink: 0,
                cursor: run ? "default" : undefined,
                touchAction: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            />
          );
        })}
      </div>
      <RunTooltip run={tooltip.run} pos={tooltip.pos} isDark={isDark} />
    </div>
  );
}

const PAGE_SIZE = 10;

function FilterPills({ options, active, onChange, isDark }) {
  const pill = (val, label) => {
    const isActive = active === val;
    return (
      <button key={val} onClick={() => onChange(val)} style={{
        fontFamily: "monospace", fontSize: 11, letterSpacing: "0.04em",
        padding: "3px 10px", borderRadius: 20, cursor: "pointer",
        border: `1px solid ${isActive
          ? "rgba(232,160,32,0.6)"
          : isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"}`,
        background: isActive
          ? "rgba(232,160,32,0.12)"
          : "transparent",
        color: isActive ? "var(--color-amber)" : "inherit",
        opacity: isActive ? 1 : 0.6,
        transition: "all 0.15s",
      }}>{label}</button>
    );
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {pill("all", "All")}
      {options.map(o => pill(o, o))}
    </div>
  );
}

function ShowMoreFooter({ shown, total, onShowMore, isDark }) {
  if (shown >= total) return null;
  const remaining = total - shown;
  return (
    <button onClick={onShowMore} style={{
      width: "100%", padding: "10px 0",
      background: "transparent",
      border: "none",
      borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
      cursor: "pointer", fontFamily: "monospace", fontSize: 12,
      opacity: 0.55,
      color: "inherit",
    }}>
      Show {remaining} more ↓
    </button>
  );
}

function IngestionRunsTable({ runs, isDark }) {
  if (!runs || runs.length === 0) return null;
  const [sourceFilter, setSourceFilter] = useState("all");
  const [shown, setShown] = useState(PAGE_SIZE);

  const sources = [...new Set(runs.map(r => r.source))].sort();
  const filtered = sourceFilter === "all" ? runs : runs.filter(r => r.source === sourceFilter);
  const visible = filtered.slice(0, shown);

  const headerBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const rowBorder = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

  return (
    <div>
      <FilterPills options={sources} active={sourceFilter} onChange={v => { setSourceFilter(v); setShown(PAGE_SIZE); }} isDark={isDark} />
      <div style={{
        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
        border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
        borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace" }}>
            <thead>
              <tr style={{ background: headerBg }}>
                {["Source", "Status", "Fetched", "New", "Updated", "Stale", "Errors", "Duration", "When"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((run, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${rowBorder}` }} title={run.error_message || ""}>
                  <td style={{ padding: "8px 12px", fontWeight: 500 }}>{run.source}</td>
                  <td style={{ padding: "8px 12px" }}><RunStatusBadge status={run.status} totalFetched={run.total_fetched} /></td>
                  <td style={{ padding: "8px 12px" }}>{run.total_fetched ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: run.total_new > 0 ? "#22c55e" : undefined }}>{run.total_new ?? "—"}</td>
                  <td style={{ padding: "8px 12px" }}>{run.total_updated ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: run.total_stale > 0 ? "#f59e0b" : undefined }}>{run.total_stale ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: run.total_errors > 0 ? "#ef4444" : undefined }}>{run.total_errors ?? 0}</td>
                  <td style={{ padding: "8px 12px" }}>{formatDuration(run.duration_ms)}</td>
                  <td style={{ padding: "8px 12px", opacity: 0.6, whiteSpace: "nowrap" }}>{relativeTime(run.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ShowMoreFooter shown={shown} total={filtered.length} onShowMore={() => setShown(s => s + PAGE_SIZE)} isDark={isDark} />
      </div>
    </div>
  );
}

function TransformRunsTable({ runs, isDark }) {
  if (!runs || runs.length === 0) return null;
  const [sourceFilter, setSourceFilter] = useState("all");
  const [shown, setShown] = useState(PAGE_SIZE);

  const sources = [...new Set(runs.map(r => r.source).filter(Boolean))].sort();
  const filtered = sourceFilter === "all" ? runs : runs.filter(r => r.source === sourceFilter);
  const visible = filtered.slice(0, shown);

  const headerBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const rowBorder = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

  return (
    <div>
      <FilterPills options={sources} active={sourceFilter} onChange={v => { setSourceFilter(v); setShown(PAGE_SIZE); }} isDark={isDark} />
      <div style={{
        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
        border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
        borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace" }}>
            <thead>
              <tr style={{ background: headerBg }}>
                {["Job", "Source", "Status", "Processed", "Failed", "Gemini", "Fallback", "Duration", "When"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((run, i) => {
                const fallbackRate = run.gemini_calls > 0 ? ((run.gemini_fallback_count || 0) / run.gemini_calls * 100).toFixed(1) : null;
                const fbColor = fallbackRate > 10 ? "#ef4444" : fallbackRate > 5 ? "#f59e0b" : "#22c55e";
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${rowBorder}` }} title={run.error_message || ""}>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{run.job_name}</td>
                    <td style={{ padding: "8px 12px" }}>{run.source || "—"}</td>
                    <td style={{ padding: "8px 12px" }}><RunStatusBadge status={run.status} /></td>
                    <td style={{ padding: "8px 12px" }}>{run.records_processed ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: run.records_failed > 0 ? "#ef4444" : undefined }}>{run.records_failed ?? 0}</td>
                    <td style={{ padding: "8px 12px" }}>{run.gemini_calls ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {run.gemini_fallback_count != null ? (
                        <span style={{ color: fbColor }}>
                          {run.gemini_fallback_count}
                          {fallbackRate != null && <span style={{ opacity: 0.6 }}> ({fallbackRate}%)</span>}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{formatDuration(run.duration_ms)}</td>
                    <td style={{ padding: "8px 12px", opacity: 0.6, whiteSpace: "nowrap" }}>{relativeTime(run.started_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ShowMoreFooter shown={shown} total={filtered.length} onShowMore={() => setShown(s => s + PAGE_SIZE)} isDark={isDark} />
      </div>
    </div>
  );
}

function DbHealthCard({ isDark }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);

  const ping = useCallback(async () => {
    setLoading(true);
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/api/db-health`);
      const json = await res.json();
      const clientMs = Math.round(performance.now() - t0);
      const result = { ...json, client_rtt_ms: clientMs, ts: Date.now() };
      setData(result);
      setHistory(prev => [...prev.slice(-19), result]);
    } catch (err) {
      const result = { status: "error", error: err.message, db_latency_ms: null, client_rtt_ms: Math.round(performance.now() - t0), ts: Date.now() };
      setData(result);
      setHistory(prev => [...prev.slice(-19), result]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { ping(); }, [ping]);

  const statusColor = !data || loading ? "#6b7280"
    : data.status === "ok" && data.db_latency_ms < 300 ? "#22c55e"
    : data.status === "ok" ? "#f59e0b"
    : "#ef4444";
  const statusLabel = loading ? "Checking…"
    : data?.status === "ok" && data.db_latency_ms < 300 ? "Healthy"
    : data?.status === "ok" ? "Slow"
    : "Unreachable";

  const bg = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
  const muted = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";

  return (
    <div style={{
      background: bg,
      border: `1px solid ${statusColor}33`,
      borderRadius: 12, padding: "20px 24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Supabase DB (Pooler)</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Singapore → Mumbai via Supavisor (port 6543)
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {data?.db_latency_ms != null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: data.db_latency_ms > 300 ? "#f59e0b" : "#22c55e" }}>
                {data.db_latency_ms}
              </div>
              <div style={{ fontSize: 10, opacity: 0.5 }}>db ms</div>
            </div>
          )}
          {data?.client_rtt_ms != null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "monospace", opacity: 0.6 }}>
                {data.client_rtt_ms}
              </div>
              <div style={{ fontSize: 10, opacity: 0.5 }}>rtt ms</div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
      </div>

      {/* Latency sparkline */}
      {history.length > 1 && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "flex-end", gap: 2, height: 32 }}>
          {history.map((h, i) => {
            const val = h.db_latency_ms ?? 0;
            const max = Math.max(...history.map(x => x.db_latency_ms ?? 0), 100);
            const pct = Math.max(4, (val / max) * 100);
            const c = h.status !== "ok" ? "#ef4444" : val > 300 ? "#f59e0b" : "#22c55e";
            return (
              <div key={i} title={`${val}ms`} style={{
                flex: 1, height: `${pct}%`, minHeight: 3,
                background: c, borderRadius: 2, opacity: 0.7,
              }} />
            );
          })}
        </div>
      )}

      {/* Ping button */}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={ping} disabled={loading} style={{
          fontFamily: "monospace", fontSize: 11, padding: "4px 12px",
          borderRadius: 6, border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"}`,
          background: "transparent", color: "inherit", cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.5 : 1,
        }}>
          Ping
        </button>
        {history.length > 0 && (
          <span style={{ fontSize: 11, color: muted }}>
            {history.length} sample{history.length > 1 ? "s" : ""}
            {history.length > 1 && ` · avg ${Math.round(history.reduce((a, h) => a + (h.db_latency_ms || 0), 0) / history.filter(h => h.db_latency_ms).length)}ms`}
          </span>
        )}
      </div>

      {data?.error && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: `1px solid ${statusColor}22`,
          fontSize: 12, color: "#ef4444", fontFamily: "monospace",
          wordBreak: "break-word",
        }}>
          {data.error}
        </div>
      )}
    </div>
  );
}

function GeminiHealthCard({ isDark }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/gemini-health`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setData({ status: "unavailable", model: null, latency_ms: null }); setLoading(false); });
  }, []);

  const bg = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
  const statusColor = !data || loading ? "#6b7280"
    : data.status === "ok"          ? "#22c55e"
    : data.status === "no_key"      ? "#f59e0b"
    : "#ef4444";
  const statusLabel = loading ? "Checking…"
    : data?.status === "ok"         ? "Available"
    : data?.status === "no_key"     ? "No API key"
    : "Unavailable";

  return (
    <div style={{
      background: bg,
      border: `1px solid ${statusColor}33`,
      borderRadius: 12, padding: "16px 20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Gemini API</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            {data?.status === "ok" ? data.model : "Primary model: gemini-2.0-flash-lite"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {data?.latency_ms != null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: data.latency_ms > 3000 ? "#f59e0b" : "#22c55e" }}>
                {data.latency_ms}
              </div>
              <div style={{ fontSize: 10, opacity: 0.5 }}>ms</div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
      </div>
      {data?.error && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: `1px solid ${statusColor}22`,
          fontSize: 12, color: "#ef4444", fontFamily: "monospace",
          wordBreak: "break-word",
        }}>
          {data.error}
        </div>
      )}
    </div>
  );
}

function GeminiFallbackCard({ pending, isDark }) {
  if (!pending) return null;
  const total = (pending.listings_curated || 0) + (pending.feed_curated || 0);
  const color = total > 10 ? "#ef4444" : total > 0 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{
      background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
      border: `1px solid ${color}22`,
      borderRadius: 12, padding: "16px 20px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Gemini Fallback Queue</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>Records awaiting re-processing after Gemini errors</div>
      </div>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "monospace" }}>{pending.listings_curated || 0}</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>listings</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "monospace" }}>{pending.feed_curated || 0}</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>feed</div>
        </div>
      </div>
    </div>
  );
}

function ListingHealthBar({ statusCounts, isDark }) {
  if (!statusCounts || Object.keys(statusCounts).length === 0) return null;
  const sources = Object.keys(statusCounts).sort();
  return (
    <div style={{
      background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
      borderRadius: 12, overflow: "hidden",
    }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace" }}>
          <thead>
            <tr style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
              {["Source", "Active", "Stale", "Expired", "Total"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, opacity: 0.7 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map(src => {
              const s = statusCounts[src];
              const active = s.active || 0;
              const stale = s.stale || 0;
              const expired = s.expired || 0;
              const total = active + stale + expired;
              return (
                <tr key={src} style={{ borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}` }}>
                  <td style={{ padding: "8px 12px", fontWeight: 500, textTransform: "capitalize" }}>{src}</td>
                  <td style={{ padding: "8px 12px", color: "#22c55e" }}>{active}</td>
                  <td style={{ padding: "8px 12px", color: stale > 0 ? "#f59e0b" : undefined }}>{stale}</td>
                  <td style={{ padding: "8px 12px", color: expired > 0 ? "#ef4444" : undefined }}>{expired}</td>
                  <td style={{ padding: "8px 12px", opacity: 0.6 }}>{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [data, setData] = useState(null);
  const [feedData, setFeedData] = useState(null);
  const [pipelineData, setPipelineData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [activeTab, setActiveTab] = useState("live");

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [listingsRes, feedRes, pipelineRes] = await Promise.all([
        fetch(`${API_BASE}/api/ingestion/status`),
        fetch(`${API_BASE}/api/locality-feed/status`),
        fetch(`${API_BASE}/api/pipeline-status`),
      ]);
      if (!listingsRes.ok) throw new Error(`Listings API HTTP ${listingsRes.status}`);
      const json = await listingsRes.json();
      setData(json);
      if (feedRes.ok) {
        const feedJson = await feedRes.json();
        setFeedData(feedJson);
      }
      if (pipelineRes.ok) {
        const pipeJson = await pipelineRes.json();
        setPipelineData(pipeJson);
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
  const allSourceIds = ["reddit", "telegram", "nobroker", "housing", "99acres", "zolo", "colive"];
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

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

        {/* Tab bar */}
        <div style={{
          display: "flex", gap: 2,
          background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
          borderRadius: 10, padding: 3, marginBottom: 24,
        }}>
          {[
            { id: "live", label: "Live Status" },
            { id: "runs", label: "Pipeline Runs" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: "10px 0", border: "none", borderRadius: 8,
                fontFamily: "monospace", fontSize: 12, letterSpacing: "0.04em",
                cursor: "pointer", transition: "background 0.15s, color 0.15s",
                background: activeTab === tab.id ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)") : "transparent",
                color: activeTab === tab.id ? text : muted,
                fontWeight: activeTab === tab.id ? 600 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#ef4444",
          }}>
            Failed to load status: {error}
          </div>
        )}

        {/* ═══════ TAB: LIVE STATUS ═══════ */}
        {activeTab === "live" && (
          <>
            {/* DB connectivity */}
            <div style={{ marginBottom: 16 }}>
              <DbHealthCard isDark={isDark} />
            </div>

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
          </>
        )}

        {/* ═══════ TAB: PIPELINE RUNS ═══════ */}
        {activeTab === "runs" && (
          <>
            {/* Recent ingestion runs */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", opacity: 0.45, marginBottom: 12,
              }}>
                Recent Ingestion Runs (last 5 per source)
              </div>
              {(() => {
                const byListings = Object.fromEntries(Object.keys(SOURCE_META).map(s => [s, []]));
                const byFeed = Object.fromEntries(Object.keys(FEED_INGEST_META).map(s => [s, []]));
                (pipelineData?.recent_runs || []).forEach(r => {
                  if (byListings[r.source] !== undefined && byListings[r.source].length < 5)
                    byListings[r.source].push(r);
                  else if (byFeed[r.source] !== undefined && byFeed[r.source].length < 5)
                    byFeed[r.source].push(r);
                });
                const groupLabel = (text) => (
                  <div style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.1em",
                    textTransform: "uppercase", opacity: 0.4, marginBottom: 6, marginTop: 4,
                  }}>{text}</div>
                );
                return (
                  <>
                    <RunDotsLegend isDark={isDark} />
                    <div style={{ marginBottom: 16 }}>
                      {groupLabel("Listings")}
                      {Object.entries(byListings).map(([src, runs]) => (
                        <RunDots key={src} label={SOURCE_META[src]?.label || src} runs={runs} isDark={isDark} />
                      ))}
                      {groupLabel("Feed")}
                      {Object.entries(byFeed).map(([src, runs]) => (
                        <RunDots key={src} label={FEED_INGEST_META[src]?.label || src} runs={runs} isDark={isDark} />
                      ))}
                    </div>
                    {pipelineData?.recent_runs?.length > 0
                      ? <IngestionRunsTable runs={pipelineData.recent_runs} isDark={isDark} />
                      : <div style={{ fontSize: 13, opacity: 0.5, padding: "16px 0" }}>No ingestion runs recorded yet.</div>
                    }
                  </>
                );
              })()}
            </div>

            {/* Transform runs — last 5 per job */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", opacity: 0.45, marginBottom: 12,
              }}>
                Transform Runs (last 5 per job)
              </div>
              {pipelineData?.transform_runs?.length > 0 ? (() => {
                const byJob = {};
                pipelineData.transform_runs.forEach(r => {
                  if (!byJob[r.job_name]) byJob[r.job_name] = [];
                  if (byJob[r.job_name].length < 5) byJob[r.job_name].push(r);
                });
                return (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      {Object.entries(byJob).map(([job, runs]) => (
                        <RunDots key={job} label={job} runs={runs} isDark={isDark} />
                      ))}
                    </div>
                    <TransformRunsTable runs={pipelineData.transform_runs} isDark={isDark} />
                  </>
                );
              })() : (
                <div style={{ fontSize: 13, opacity: 0.5, padding: "16px 0" }}>No transform runs recorded yet.</div>
              )}
            </div>

            {/* Listing health by source x status */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", opacity: 0.45, marginBottom: 12,
              }}>
                Listing Health by Source
              </div>
              <ListingHealthBar statusCounts={pipelineData?.by_source_status} isDark={isDark} />
            </div>

            {/* Gemini status */}
            <div style={{ marginBottom: 12 }}>
              <GeminiHealthCard isDark={isDark} />
            </div>
            <div style={{ marginBottom: 32 }}>
              <GeminiFallbackCard pending={pipelineData?.gemini_fallback_pending} isDark={isDark} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
