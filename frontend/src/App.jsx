import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const API_BASE = import.meta.env.VITE_API_URL || "";
const SUBREDDITS = ["r/bangalore", "r/bengaluru", "r/indianrealestate", "r/bangalorerentals", "r/FlatandFlatmatesBLR", "r/FlatmatesinBangalore"];

const SOURCE_DEFS = [
  { id: "reddit",   label: "Reddit",   icon: "🟠", color: "#ff4500" },
  { id: "telegram", label: "Telegram", icon: "✈️",  color: "#229ed9" },
  { id: "nobroker", label: "NoBroker", icon: "🔴", color: "#e63946" },
];

const BANGALORE_AREAS = [
  "Indiranagar", "Whitefield", "Koramangala", "HSR Layout", "HSR",
  "Bellandur", "Marathahalli", "Sarjapur", "BTM Layout", "BTM",
  "Jayanagar", "Hebbal", "Yelahanka", "Electronic City", "Bannerghatta",
  "Cunningham", "MG Road", "Frazer Town", "Banaswadi", "Hoodi",
  "KR Puram", "Domlur", "Madiwala", "Bommanahalli", "Brookefield",
  "Kadubeesanahalli", "Panathur", "Varthur", "Thubarahalli", "Kadugodi",
  "JP Nagar", "Banashankari", "Rajajinagar", "Malleshwaram", "Yeshwanthpur",
  "Nagawara", "HBR Layout", "CV Raman Nagar", "Old Airport Road",
];

const LOCALITY_COORDS = {
  "Indiranagar":      [12.9784, 77.6408],
  "Whitefield":       [12.9698, 77.7499],
  "Koramangala":      [12.9352, 77.6245],
  "HSR Layout":       [12.9116, 77.6389],
  "HSR":              [12.9116, 77.6389],
  "Bellandur":        [12.9257, 77.6761],
  "Marathahalli":     [12.9591, 77.6974],
  "Sarjapur":         [12.8604, 77.7090],
  "BTM Layout":       [12.9165, 77.6101],
  "BTM":              [12.9165, 77.6101],
  "Jayanagar":        [12.9299, 77.5820],
  "Hebbal":           [13.0353, 77.5947],
  "Yelahanka":        [13.1007, 77.5963],
  "Electronic City":  [12.8399, 77.6770],
  "Bannerghatta":     [12.8634, 77.5855],
  "Cunningham":       [12.9812, 77.5958],
  "MG Road":          [12.9756, 77.6099],
  "Frazer Town":      [12.9854, 77.6146],
  "Banaswadi":        [13.0109, 77.6553],
  "Hoodi":            [12.9876, 77.7028],
  "KR Puram":         [13.0068, 77.6943],
  "Domlur":           [12.9609, 77.6387],
  "Madiwala":         [12.9196, 77.6182],
  "Bommanahalli":     [12.8998, 77.6396],
  "Brookefield":      [12.9690, 77.7123],
  "Kadubeesanahalli": [12.9354, 77.7004],
  "Panathur":         [12.9344, 77.7127],
  "Varthur":          [12.9352, 77.7489],
  "Thubarahalli":     [12.9572, 77.7225],
  "Kadugodi":         [12.9775, 77.7593],
  "JP Nagar":         [12.9077, 77.5851],
  "Banashankari":     [12.9259, 77.5468],
  "Rajajinagar":      [12.9899, 77.5530],
  "Malleshwaram":     [13.0035, 77.5687],
  "Yeshwanthpur":     [13.0265, 77.5449],
  "Nagawara":         [13.0435, 77.6202],
  "HBR Layout":       [13.0277, 77.6384],
  "CV Raman Nagar":   [12.9848, 77.6618],
  "Old Airport Road": [12.9592, 77.6484],
};

function extractListingInfo(title, body) {
  const text = `${title} ${body}`;
  const lower = text.toLowerCase();

  // BHK
  const bhkMatch = text.match(/\b([1-4])\s*[-–]?\s*BHK\b/i)
    || text.match(/\b([1-4])\s*bedroom/i)
    || text.match(/\b(studio|1rk)\b/i);
  const bhk = bhkMatch
    ? (bhkMatch[0].match(/studio/i) ? "Studio" : bhkMatch[0].match(/1rk/i) ? "1RK" : `${bhkMatch[1]} BHK`)
    : null;

  // Locality — longest match wins to prefer "HSR Layout" over "HSR"
  const sortedAreas = [...BANGALORE_AREAS].sort((a, b) => b.length - a.length);
  const locality = sortedAreas.find(area => lower.includes(area.toLowerCase())) || null;

  // Price — handles: ₹25000, Rs 25,000, 25k/month, 25000 pm, 25000 per month
  let price = null;
  const pricePatterns = [
    /(?:₹|rs\.?\s*)(\d[\d,]*)\s*(?:\/?\s*(?:month|mo|pm|per\s*month))?/i,
    /(\d+(?:\.\d+)?)\s*k\s*(?:\/?\s*(?:month|mo|pm|per\s*month))/i,
    /(\d[\d,]+)\s*(?:per\s*month|\/month|pm\b)/i,
  ];
  for (const pat of pricePatterns) {
    const m = text.match(pat);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g, ""));
      if (pat.source.includes("k\\s*(?:")) val *= 1000;
      if (val >= 2000 && val <= 500000) {
        price = `₹${val.toLocaleString("en-IN")}/mo`;
        break;
      }
    }
  }

  // Furnished status
  let furnished = null;
  if (/semi[\s-]?furnished/i.test(text))       furnished = "Semi-furnished";
  else if (/\bunfurnished\b/i.test(text))       furnished = "Unfurnished";
  else if (/\bfurnished\b/i.test(text))         furnished = "Furnished";

  // Indian mobile number
  const phoneMatch = text.match(/(?<!\d)([6-9]\d{9})(?!\d)/);
  const phone = phoneMatch ? phoneMatch[1] : null;

  return { bhk, locality, price, furnished, phone };
}

function Pill({ icon, label, bg, color, extra }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      background: bg, color, fontSize: "10px", fontFamily: "monospace",
      padding: "3px 8px", borderRadius: "20px", whiteSpace: "nowrap",
    }}>
      {icon} {label}{extra}
    </span>
  );
}


/** Safely format a price value that may be an int, a "₹18,000" string, or null. */
function formatPriceValue(price, priceFormatted) {
  if (priceFormatted) return priceFormatted;
  if (!price && price !== 0) return null;
  if (typeof price === "string") return price; // already a display string
  const n = Number(price);
  return Number.isFinite(n) && n > 0 ? `₹${n.toLocaleString("en-IN")}` : null;
}

function timeAgo(utcSeconds) {
  const diff = Math.floor(Date.now() / 1000 - utcSeconds);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ContactPill({ contact }) {
  const [copied, setCopied] = useState(false);
  const copy = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(contact).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      background: "rgba(245,130,32,0.15)", color: "#f5a623",
      fontSize: "10px", fontFamily: "monospace",
      padding: "3px 8px", borderRadius: "20px", whiteSpace: "nowrap",
    }}>
      📞 {contact}
      <button
        onClick={copy}
        style={{
          background: copied ? "rgba(245,166,35,0.3)" : "rgba(245,166,35,0.15)",
          border: "none", color: "#f5a623", fontSize: "9px",
          fontFamily: "monospace", cursor: "pointer",
          padding: "1px 5px", borderRadius: "10px", marginLeft: "2px",
          transition: "background 0.2s",
        }}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </span>
  );
}

function SourceBadge({ source }) {
  const def = SOURCE_DEFS.find(s => s.id === source) || SOURCE_DEFS[0];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      background: `${def.color}22`,
      color: def.color,
      border: `1px solid ${def.color}44`,
      fontSize: "9px", fontFamily: "monospace",
      padding: "2px 7px", borderRadius: "4px",
      letterSpacing: "0.05em", flexShrink: 0,
    }}>
      {def.icon} {def.label.toUpperCase()}
    </span>
  );
}

function PostCard({ post, index, lastVisit, isSaved, onSave, onHide, onToast }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered,  setHovered]  = useState(false);
  const isTop           = index < 3;
  const isNewSinceVisit = post.created > lastVisit;
  const isTelegram      = post.source === "telegram";
  const isNoBroker      = post.source === "nobroker";

  // For Reddit: extract from text. For Telegram/NoBroker: prefer server-provided fields.
  const bodyText = (isTelegram || isNoBroker) ? (post.body || "") : (post.selftext || "");
  const { bhk: clientBhk, locality: clientLocality, price: clientPrice, furnished: clientFurnished, phone: clientPhone } =
    extractListingInfo(post.title, bodyText);

  const displayPrice = (isTelegram || isNoBroker)
    ? formatPriceValue(post.price, post.price_formatted)
    : (clientPrice || post.price);
  const displayContact  = isNoBroker ? null : (isTelegram ? post.contact : (clientPhone || post.contact));
  const displayBhk      = isNoBroker ? post.bhk      : (isTelegram ? (post.bhk      || clientBhk)      : clientBhk);
  const displayLocality = isNoBroker ? post.locality  : (isTelegram ? (post.locality || clientLocality) : clientLocality);
  const displayFurnished = isNoBroker ? post.furnishing : (isTelegram ? (post.furnishing || clientFurnished) : clientFurnished);

  const hasPills = displayBhk || displayLocality || displayPrice || displayFurnished || displayContact
    || (isNoBroker && (post.area_sqft || post.deposit_formatted))
    || (isTelegram && (post.deposit_text || post.no_brokerage || post.is_flatmate));

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  const handleCopy = (e) => {
    stop(e);
    if (!displayContact) return;
    navigator.clipboard.writeText(displayContact).then(() => onToast("📋 Number copied!"));
  };
  const handleOpen = (e) => {
    stop(e);
    window.open(post.url, "_blank", "noopener,noreferrer");
  };
  const handleSave = (e) => {
    stop(e);
    onSave(post);
    onToast(isSaved ? "Removed from saved listings" : "💾 Listing saved!");
  };
  const handleHide = (e) => {
    stop(e);
    onHide(post.id);
    onToast("🚫 Listing hidden");
  };

  const actionBtn = (icon, label, onClick, opts = {}) => (
    <button
      key={label}
      onClick={onClick}
      disabled={opts.disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: "5px",
        background: opts.active ? "rgba(245,166,35,0.15)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${opts.active ? "rgba(245,166,35,0.35)" : "#2a2a3a"}`,
        borderRadius: "5px", padding: "5px 11px",
        color: opts.disabled ? "#333" : opts.active ? "#f5a623" : "#666",
        fontSize: "10px", fontFamily: "monospace",
        cursor: opts.disabled ? "default" : "pointer",
        transition: "all 0.15s",
        opacity: opts.disabled ? 0.4 : 1,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={e => {
        if (opts.disabled) return;
        e.currentTarget.style.background = opts.active ? "rgba(245,166,35,0.25)" : "rgba(255,255,255,0.08)";
        e.currentTarget.style.color = opts.active ? "#f5a623" : "#ccc";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = opts.active ? "rgba(245,166,35,0.15)" : "rgba(255,255,255,0.04)";
        e.currentTarget.style.color = opts.disabled ? "#333" : opts.active ? "#f5a623" : "#666";
      }}
    >
      {icon} {label}
    </button>
  );

  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        textDecoration: "none",
        background: isNewSinceVisit ? "rgba(74,222,128,0.03)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${isNewSinceVisit ? "rgba(74,222,128,0.15)" : "rgba(245,166,35,0.1)"}`,
        borderLeft: `3px solid ${isNewSinceVisit ? "#4ade80" : isTop ? "#f5a623" : "#2a2a3a"}`,
        borderRadius: "6px",
        padding: "16px 18px",
        marginBottom: "10px",
        transition: "all 0.18s ease",
      }}
      onMouseEnter={e => {
        setHovered(true);
        e.currentTarget.style.background = isNewSinceVisit ? "rgba(74,222,128,0.07)" : "rgba(245,166,35,0.05)";
        e.currentTarget.style.borderLeftColor = isNewSinceVisit ? "#4ade80" : "#f5a623";
        e.currentTarget.style.transform = "translateX(3px)";
      }}
      onMouseLeave={e => {
        setHovered(false);
        e.currentTarget.style.background = isNewSinceVisit ? "rgba(74,222,128,0.03)" : "rgba(255,255,255,0.025)";
        e.currentTarget.style.borderLeftColor = isNewSinceVisit ? "#4ade80" : isTop ? "#f5a623" : "#2a2a3a";
        e.currentTarget.style.transform = "translateX(0)";
      }}
    >
      {/* NoBroker thumbnail */}
      {isNoBroker && post.thumbnail && (
        <img
          src={post.thumbnail}
          alt="property"
          style={{
            width: "100%", maxHeight: "160px", objectFit: "cover",
            borderRadius: "4px", marginBottom: "10px",
            border: "1px solid #1a1a24",
          }}
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      )}

      {/* Title row */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: isTelegram && post.subtitle ? "4px" : "7px" }}>
        <div style={{ color: "#e8e4d8", fontSize: "14px", fontFamily: "'Georgia', serif", lineHeight: "1.5", flex: 1 }}>
          {isNewSinceVisit && (
            <span style={{
              background: "rgba(74,222,128,0.2)", color: "#4ade80", fontSize: "8px",
              fontWeight: 800, padding: "2px 6px", borderRadius: "3px",
              marginRight: "8px", letterSpacing: "0.1em", verticalAlign: "middle",
              border: "1px solid rgba(74,222,128,0.35)",
            }}>NEW</span>
          )}
          {isNoBroker && post.sponsored && (
            <span style={{
              background: "rgba(255,255,255,0.06)", color: "#555", fontSize: "8px",
              padding: "2px 6px", borderRadius: "3px", marginRight: "8px",
              verticalAlign: "middle", border: "1px solid #2a2a3a",
            }}>Sponsored</span>
          )}
          {post.title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px", flexShrink: 0 }}>
          <SourceBadge source={post.source || "reddit"} />
          {post.quality_score != null && <ScoreBadge score={post.quality_score} post={post} />}
          <span style={{ color: "#3a3a4a", fontSize: "10px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
            {isNoBroker && post.last_update_string ? post.last_update_string : timeAgo(post.created)}
          </span>
        </div>
      </div>

      {/* Telegram subtitle — only when it adds info beyond the title */}
      {isTelegram && post.subtitle &&
       post.subtitle.toLowerCase().trim() !== post.title.toLowerCase().trim() && (
        <div style={{
          color: "#666", fontSize: "11px", fontFamily: "monospace",
          lineHeight: "1.4", marginBottom: "8px", fontStyle: "italic",
        }}>
          {post.subtitle.length > 90 ? post.subtitle.slice(0, 90) + "…" : post.subtitle}
        </div>
      )}

      {/* Info pills */}
      {hasPills && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
          {displayBhk && (isNoBroker && post.area_sqft)
            ? <Pill icon="🏠" label={`${displayBhk} · ${post.area_sqft} sqft`} bg="rgba(59,130,246,0.15)" color="#7eb8f7" />
            : displayBhk && <Pill icon="🏠" label={displayBhk} bg="rgba(59,130,246,0.15)" color="#7eb8f7" />}
          {displayLocality && <Pill icon="📍" label={displayLocality} bg="rgba(255,255,255,0.06)" color="#999" />}
          {displayPrice    && <Pill icon="💰" label={String(displayPrice)} bg="rgba(34,197,94,0.15)" color="#6ee09a" />}
          {displayFurnished && <Pill icon="🛋️" label={displayFurnished} bg="rgba(168,85,247,0.15)" color="#c084fc" />}
          {isNoBroker && post.deposit_formatted && (
            <Pill icon="🔒" label={`Deposit: ${post.deposit_formatted}`} bg="rgba(255,255,255,0.04)" color="#777" />
          )}
          {isNoBroker && post.lease_type && post.lease_type !== "ANYONE" && (
            <Pill icon="👤" label={post.lease_type.charAt(0) + post.lease_type.slice(1).toLowerCase()} bg="rgba(255,255,255,0.04)" color="#666" />
          )}
          {isTelegram && post.deposit_text && (
            <Pill icon="🔒" label={`Deposit: ₹${post.deposit_text}`} bg="rgba(255,255,255,0.04)" color="#777" />
          )}
          {isTelegram && post.no_brokerage && (
            <Pill icon="✅" label="No Brokerage" bg="rgba(34,197,94,0.12)" color="#4ade80" />
          )}
          {isTelegram && post.is_flatmate && (
            <Pill icon="🤝" label="Flatmate" bg="rgba(168,85,247,0.15)" color="#c084fc" />
          )}
          {displayContact && <ContactPill contact={displayContact} />}
        </div>
      )}

      {/* Telegram amenities row */}
      {isTelegram && post.amenities && post.amenities.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
          {post.amenities.slice(0, 4).map(a => (
            <span key={a} style={{
              background: "rgba(255,255,255,0.04)", color: "#555",
              fontSize: "9px", fontFamily: "monospace",
              padding: "2px 7px", borderRadius: "10px",
              border: "1px solid #1e1e2e",
            }}>{a}</span>
          ))}
          {post.amenities.length > 4 && (
            <span style={{
              background: "rgba(255,255,255,0.04)", color: "#444",
              fontSize: "9px", fontFamily: "monospace",
              padding: "2px 7px", borderRadius: "10px",
              border: "1px solid #1e1e2e",
            }}>+{post.amenities.length - 4} more</span>
          )}
        </div>
      )}

      {/* Meta — differs by source */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
        {isNoBroker ? (
          <>
            {post.society && (
              <span style={{ color: "#e63946", fontSize: "10px", fontFamily: "monospace", opacity: 0.8 }}>
                🏢 {post.society}
              </span>
            )}
            {post.owner_name && (
              <span style={{ color: "#555", fontSize: "10px", fontFamily: "monospace" }}>
                Owner: {post.owner_name}
              </span>
            )}
            {post.amenities && post.amenities.length > 0 && (
              <span style={{ color: "#444", fontSize: "10px", fontFamily: "monospace" }}>
                {post.amenities.join(" · ")}
              </span>
            )}
          </>
        ) : isTelegram ? (
          <>
            <span style={{ color: "#229ed9", fontSize: "10px", fontFamily: "monospace", opacity: 0.8 }}>
              {post.group}
            </span>
            {post.maps_url && (
              <a
                href={post.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={stop}
                style={{
                  color: "#6ee09a", fontSize: "10px", fontFamily: "monospace",
                  textDecoration: "none", opacity: 0.85,
                  display: "inline-flex", alignItems: "center", gap: "3px",
                }}
              >
                📍 View on Maps
              </a>
            )}
          </>
        ) : (
          <>
            <span style={{ color: "#f5a623", fontSize: "10px", fontFamily: "monospace", opacity: 0.7 }}>
              r/{post.subreddit}
            </span>
            <span style={{ color: "#3a3a4a", fontSize: "10px", fontFamily: "monospace" }}>
              u/{post.author}
            </span>
            {post.flair && (
              <span style={{
                color: "#888", fontSize: "9px", fontFamily: "monospace",
                background: "rgba(255,255,255,0.04)", padding: "1px 6px", borderRadius: "3px",
              }}>
                {post.flair}
              </span>
            )}
            <span style={{ color: "#333", fontSize: "10px", fontFamily: "monospace", marginLeft: "auto" }}>
              ↑ {post.score} · 💬 {post.comments}
            </span>
          </>
        )}
      </div>

      {/* Body */}
      {bodyText && (
        <div>
          <div style={{
            color: "#555", fontSize: "12px", fontFamily: "monospace",
            lineHeight: "1.6", maxHeight: expanded ? "none" : "36px", overflow: "hidden",
          }}>
            {bodyText}
          </div>
          <button
            onClick={e => { stop(e); setExpanded(!expanded); }}
            style={{
              background: "none", border: "none", color: "#f5a623",
              fontSize: "10px", fontFamily: "monospace", cursor: "pointer",
              padding: "4px 0 0 0", opacity: 0.6,
            }}
          >
            {expanded ? "▲ less" : "▼ more"}
          </button>
        </div>
      )}

      {/* Quick actions bar — hover only */}
      {hovered && (
        <div
          onClick={e => e.preventDefault()}
          style={{
            display: "flex", flexWrap: "wrap", gap: "6px",
            marginTop: "12px", paddingTop: "10px",
            borderTop: "1px solid #1a1a24",
          }}
        >
          {isNoBroker ? (
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                background: "rgba(230,57,70,0.12)", border: "1px solid rgba(230,57,70,0.3)",
                borderRadius: "5px", padding: "5px 11px",
                color: "#e63946", fontSize: "10px", fontFamily: "monospace",
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              🔴 View on NoBroker
            </a>
          ) : (
            actionBtn("🔗", isTelegram ? "Open in Telegram" : "Open Post", handleOpen)
          )}
          {isNoBroker ? (
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a3a",
                borderRadius: "5px", padding: "5px 11px",
                color: "#555", fontSize: "10px", fontFamily: "monospace",
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              📞 Contact via NoBroker ↗
            </a>
          ) : isTelegram ? (
            displayContact
              ? actionBtn("📋", "Copy Number", handleCopy)
              : actionBtn("✈️", "View in Telegram", handleOpen)
          ) : (
            actionBtn("📋", displayContact ? "Copy Number" : "No Number", handleCopy, { disabled: !displayContact })
          )}
          {isTelegram && post.maps_url && (
            <a
              href={post.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: "5px", padding: "5px 11px",
                color: "#4ade80", fontSize: "10px", fontFamily: "monospace",
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              📍 Maps
            </a>
          )}
          {actionBtn(isSaved ? "💾" : "💾", isSaved ? "Saved ✓" : "Save", handleSave, { active: isSaved })}
          {actionBtn("🚫", "Hide", handleHide)}
        </div>
      )}
    </a>
  );
}

// ─── Tile grid constants & helpers ───────────────────────────────────────────
const TILES_PER_PAGE = 12;

const overlayBtnStyle = (color = "#ccc", active = false) => ({
  background: active ? `${color}22` : "rgba(255,255,255,0.07)",
  border: `1px solid ${active ? `${color}55` : "rgba(255,255,255,0.14)"}`,
  borderRadius: "6px", padding: "8px 20px",
  color: active ? color : "#ccc",
  fontSize: "11px", fontFamily: "monospace",
  cursor: "pointer", transition: "all 0.15s",
  whiteSpace: "nowrap", letterSpacing: "0.04em",
});

// ─── Pagination ───────────────────────────────────────────────────────────────
function Pagination({ page, totalPages, onPage }) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const btn = (active, disabled = false) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: "32px", height: "30px", padding: "0 10px",
    background: active ? "#f5a623" : "rgba(255,255,255,0.03)",
    color: active ? "#0d0d14" : "#555",
    border: `1px solid ${active ? "#f5a623" : "#2a2a3a"}`,
    borderRadius: "5px", fontSize: "11px", fontFamily: "monospace",
    fontWeight: active ? 800 : 400, cursor: disabled || active ? "default" : "pointer",
    transition: "all 0.15s", opacity: disabled ? 0.3 : 1,
  });
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "5px", paddingTop: "20px", borderTop: "1px solid #1a1a24" }}>
      <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page === 1} style={btn(false, page === 1)}>← Prev</button>
      {pages.map(n => (
        <button key={n} onClick={() => onPage(n)} style={btn(n === page)}
          onMouseEnter={e => { if (n !== page) { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#888"; }}}
          onMouseLeave={e => { if (n !== page) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "#555"; }}}
        >{n}</button>
      ))}
      <button onClick={() => onPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={btn(false, page === totalPages)}>Next →</button>
    </div>
  );
}

// ─── PostTile ─────────────────────────────────────────────────────────────────
function PostTile({ post, lastVisit, isSaved, onSave, onHide, onToast }) {
  const [hovered, setHovered] = useState(false);
  const isNewSinceVisit = post.created > lastVisit;
  const isTelegram      = post.source === "telegram";
  const isNoBroker      = post.source === "nobroker";
  const accentColor     = isNoBroker ? "#e63946" : isTelegram ? "#229ed9" : "#ff4500";

  const bodyText = (isTelegram || isNoBroker) ? (post.body || "") : (post.selftext || "");
  const { bhk: clientBhk, locality: clientLocality, price: clientPrice, furnished: clientFurnished, phone: clientPhone } =
    extractListingInfo(post.title, bodyText);
  const displayPrice = (isTelegram || isNoBroker)
    ? formatPriceValue(post.price, post.price_formatted)
    : (clientPrice || post.price);
  const displayContact   = isNoBroker ? null : (isTelegram ? post.contact : (clientPhone || post.contact));
  const displayBhk       = isNoBroker ? post.bhk       : (isTelegram ? (post.bhk       || clientBhk)       : clientBhk);
  const displayLocality  = isNoBroker ? post.locality   : (isTelegram ? (post.locality  || clientLocality)  : clientLocality);
  const displayFurnished = isNoBroker ? post.furnishing : (isTelegram ? (post.furnishing || clientFurnished) : clientFurnished);

  const stop       = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleOpen = (e) => { stop(e); window.open(post.url, "_blank", "noopener,noreferrer"); };
  const handleSave = (e) => { stop(e); onSave(post); onToast(isSaved ? "Removed from saved listings" : "💾 Listing saved!"); };
  const handleHide = (e) => { stop(e); onHide(post.id); onToast("🚫 Listing hidden"); };
  const handleCopy = (e) => {
    stop(e);
    if (!displayContact) return;
    navigator.clipboard.writeText(displayContact).then(() => onToast("📋 Number copied!"));
  };

  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", flexDirection: "column",
        textDecoration: "none", position: "relative", overflow: "hidden",
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${isNewSinceVisit ? "rgba(74,222,128,0.18)" : "rgba(255,255,255,0.06)"}`,
        borderTop: `3px solid ${isNewSinceVisit ? "#4ade80" : accentColor}`,
        borderRadius: "8px", padding: "14px",
        minHeight: "210px", transition: "transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
      }}
      onMouseEnter={e => {
        setHovered(true);
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={e => {
        setHovered(false);
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.background = "rgba(255,255,255,0.025)";
      }}
    >
      {/* Top row: source + NEW badge | score + time */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "9px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
          <SourceBadge source={post.source || "reddit"} />
          {isNewSinceVisit && (
            <span style={{
              background: "rgba(74,222,128,0.2)", color: "#4ade80", fontSize: "7px",
              fontWeight: 800, padding: "2px 5px", borderRadius: "3px",
              letterSpacing: "0.1em", border: "1px solid rgba(74,222,128,0.35)",
            }}>NEW</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
          {post.quality_score != null && (() => {
            const c = post.quality_score >= 70 ? "#4ade80" : post.quality_score >= 40 ? "#facc15" : "#6b7280";
            return (
              <span style={{
                background: "rgba(0,0,0,0.3)", color: c, fontSize: "10px",
                fontFamily: "monospace", fontWeight: 700,
                padding: "1px 5px", borderRadius: "4px",
                border: `1px solid ${c}44`,
                title: "Hover card to see breakdown",
              }}>{post.quality_score}</span>
            );
          })()}
          <span style={{ color: "#3a3a4a", fontSize: "9px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
            {timeAgo(post.created)}
          </span>
        </div>
      </div>

      {/* Title — 3 lines max */}
      <div style={{
        color: "#e8e4d8", fontSize: "13px", fontFamily: "'Georgia', serif",
        lineHeight: "1.5", marginBottom: "10px", flex: 1,
        display: "-webkit-box", WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {post.title}
      </div>

      {/* Pills — priority: BHK > price > locality > furnished > badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "10px" }}>
        {displayBhk && (isNoBroker && post.area_sqft)
          ? <Pill icon="🏠" label={`${displayBhk} · ${post.area_sqft} sqft`} bg="rgba(59,130,246,0.15)" color="#7eb8f7" />
          : displayBhk && <Pill icon="🏠" label={displayBhk} bg="rgba(59,130,246,0.15)" color="#7eb8f7" />}
        {displayPrice && <Pill icon="💰" label={String(displayPrice)} bg="rgba(34,197,94,0.15)" color="#6ee09a" />}
        {displayLocality
          ? <Pill icon="📍" label={displayLocality} bg="rgba(255,255,255,0.06)" color="#999" />
          : displayFurnished && <Pill icon="🛋️" label={displayFurnished} bg="rgba(168,85,247,0.15)" color="#c084fc" />}
        {isTelegram && post.no_brokerage && (
          <Pill icon="✅" label="No Brokerage" bg="rgba(34,197,94,0.12)" color="#4ade80" />
        )}
        {isTelegram && post.is_flatmate && (
          <Pill icon="🤝" label="Flatmate" bg="rgba(168,85,247,0.15)" color="#c084fc" />
        )}
      </div>

      {/* Footer meta */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <span style={{
          color: accentColor,
          fontSize: "9px", fontFamily: "monospace", opacity: 0.65,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%",
        }}>
          {isNoBroker
            ? (post.society || post.owner_name
                ? `${post.society || ""}${post.society && post.owner_name ? " · " : ""}${post.owner_name ? "Owner: " + post.owner_name : ""}`
                : "nobroker.in")
            : isTelegram ? post.group : `r/${post.subreddit}`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {isTelegram && post.maps_url && (
            <span style={{ fontSize: "9px", opacity: 0.6, color: "#4ade80" }} title="Has Maps link">📍</span>
          )}
          {displayContact && <span style={{ fontSize: "9px", opacity: 0.5 }}>📞</span>}
          {!isTelegram && !isNoBroker && (
            <span style={{ color: "#333", fontSize: "9px", fontFamily: "monospace" }}>
              ↑{post.score} 💬{post.comments}
            </span>
          )}
        </div>
      </div>

      {/* Hover action overlay */}
      {hovered && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: "7px",
          background: "rgba(10,10,18,0.92)", backdropFilter: "blur(3px)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "7px",
          padding: "12px", overflow: "hidden",
        }}>
          {/* Score breakdown section */}
          {post.quality_score != null && (() => {
            const rows      = buildScoreBreakdown(post);
            const positives = rows.filter(r => r.pts > 0).slice(0, 1);
            const penalties = rows.filter(r => r.pts < 0).slice(0, 1);
            const scoreColor =
              post.quality_score >= 70 ? "#4ade80" :
              post.quality_score >= 40 ? "#facc15" : "#6b7280";
            return (
              <>
                {/* Score number + label inline */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                  <span style={{ color: scoreColor, fontSize: "22px", fontFamily: "monospace", fontWeight: 800, lineHeight: 1 }}>
                    {post.quality_score}
                  </span>
                  <span style={{ color: "#444", fontSize: "7px", letterSpacing: "0.1em" }}>SCORE</span>
                </div>
                {/* Signal pills */}
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "3px", maxWidth: "200px" }}>
                  {positives.map((r, i) => (
                    <span key={i} style={{
                      background: "rgba(110,224,154,0.1)", color: "#6ee09a",
                      fontSize: "7.5px", fontFamily: "monospace",
                      padding: "1px 6px", borderRadius: "10px",
                      border: "1px solid rgba(110,224,154,0.2)", whiteSpace: "nowrap",
                    }}>+{r.pts} {r.label}</span>
                  ))}
                  {penalties.map((r, i) => (
                    <span key={i} style={{
                      background: "rgba(248,113,113,0.1)", color: "#f87171",
                      fontSize: "7.5px", fontFamily: "monospace",
                      padding: "1px 6px", borderRadius: "10px",
                      border: "1px solid rgba(248,113,113,0.2)", whiteSpace: "nowrap",
                    }}>{r.pts} {r.label}</span>
                  ))}
                </div>
                <div style={{ width: "50%", borderTop: "1px solid #222230" }} />
              </>
            );
          })()}

          {/* Action buttons */}
          <button onClick={handleOpen} style={overlayBtnStyle(isNoBroker ? "#e63946" : "#f5a623")}>
            {isNoBroker ? "🔴 View on NoBroker" : "🔗 Open Post"}
          </button>
          {isNoBroker ? (
            <button onClick={handleOpen} style={overlayBtnStyle("#555")}>📞 Contact via NoBroker ↗</button>
          ) : displayContact && (
            <button onClick={handleCopy} style={overlayBtnStyle("#f5a623")}>📋 Copy Number</button>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSave} style={overlayBtnStyle("#f5a623", isSaved)}>
              {isSaved ? "💾 Saved ✓" : "💾 Save"}
            </button>
            <button onClick={handleHide} style={overlayBtnStyle("#666")}>🚫 Hide</button>
          </div>
        </div>
      )}
    </a>
  );
}

function MapView({ posts }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const markersRef   = useRef([]);

  // Init Leaflet map once on mount
  useEffect(() => {
    const L = window.L;
    if (!L || !containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: [12.9716, 77.5946],
      zoom: 12,
      preferCanvas: true,
    });

    L.tileLayer(
      "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
      { attribution: "© OSM contributors © CartoDB", maxZoom: 19 }
    ).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers whenever posts change
  useEffect(() => {
    const L   = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Jitter identical coords so pins in the same area don't stack
    const coordCount = {};

    posts.forEach(post => {
      const { locality, price, bhk } = extractListingInfo(post.title, post.selftext);
      if (!locality) return;
      const base = LOCALITY_COORDS[locality];
      if (!base) return;

      const key = locality;
      coordCount[key] = (coordCount[key] || 0) + 1;
      const jitter = (coordCount[key] - 1) * 0.0008;
      const coords = [base[0] + jitter, base[1] + jitter];

      const color =
        post.quality_score >= 70 ? "#4ade80" :
        post.quality_score >= 40 ? "#facc15" :
                                   "#f87171";

      const icon = L.divIcon({
        html: `<div style="
          width:13px;height:13px;border-radius:50%;
          background:${color};
          border:2px solid rgba(0,0,0,0.45);
          box-shadow:0 0 7px ${color}aa;
          cursor:pointer;
        "></div>`,
        className: "",
        iconSize:    [13, 13],
        iconAnchor:  [6,  6],
        popupAnchor: [0, -9],
      });

      const title = post.title.length > 90 ? post.title.slice(0, 90) + "…" : post.title;
      const popup = `
        <div style="font-family:monospace;max-width:240px;">
          <div style="font-size:12px;color:#e8e4d8;line-height:1.4;margin-bottom:8px;font-family:'Georgia',serif;">
            ${title}
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px;">
            ${bhk   ? `<span style="background:rgba(59,130,246,0.25);color:#7eb8f7;padding:2px 8px;border-radius:20px;font-size:10px;">🏠 ${bhk}</span>` : ""}
            ${price ? `<span style="background:rgba(34,197,94,0.25);color:#6ee09a;padding:2px 8px;border-radius:20px;font-size:10px;">💰 ${price}</span>` : ""}
            <span style="background:rgba(255,255,255,0.06);color:#888;padding:2px 8px;border-radius:20px;font-size:10px;">📍 ${locality}</span>
          </div>
          <a href="${post.url}" target="_blank" rel="noopener noreferrer"
             style="color:#f5a623;font-size:10px;text-decoration:none;">
            🔗 Open Post →
          </a>
        </div>
      `;

      const marker = L.marker(coords, { icon })
        .bindPopup(popup, { maxWidth: 270, className: "dark-popup" })
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [posts]);

  const mappableCount = posts.filter(p => {
    const { locality } = extractListingInfo(p.title, p.selftext);
    return locality && LOCALITY_COORDS[locality];
  }).length;

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "10px",
      }}>
        <span style={{ color: "#555", fontSize: "10px", fontFamily: "monospace" }}>
          📍 {mappableCount} of {posts.length} listings have a matched locality
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "9px", fontFamily: "monospace" }}>
          {[["#4ade80", "70+ score"], ["#facc15", "40–69"], ["#f87171", "<40"]].map(([c, l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: "4px", color: "#555" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block", boxShadow: `0 0 5px ${c}88` }} />
              {l}
            </span>
          ))}
        </div>
      </div>
      <div ref={containerRef} style={{
        height: "520px", borderRadius: "8px",
        border: "1px solid #2a2a3a", overflow: "hidden",
      }} />
    </div>
  );
}

function AlertModal({ search, onClose, onCreated }) {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:    email.trim(),
          bhk:      search.bhk      || "any",
          area:     search.area     || "",
          budget:   search.budget   || "",
          keywords: search.keywords || "",
          label:    search.label,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create alert");
      setSuccess(true);
      setTimeout(() => { onCreated && onCreated(data); onClose(); }, 1800);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const iStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: `1px solid ${error ? "rgba(255,107,107,0.5)" : "#2a2a3a"}`,
    borderRadius: "6px", padding: "11px 14px",
    color: "#e8e4d8", fontSize: "13px", fontFamily: "monospace",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#0d0d1e", border: "1px solid #2a2a3a",
          borderRadius: "12px", padding: "28px",
          maxWidth: "400px", width: "100%", fontFamily: "monospace",
          boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px" }}>
          <div>
            <p style={{ color: "#f5a623", fontSize: "9px", letterSpacing: "0.2em", margin: "0 0 6px 0" }}>
              EMAIL ALERT
            </p>
            <h2 style={{ color: "#e8e4d8", fontFamily: "'Georgia',serif", fontWeight: "normal", fontSize: "18px", margin: 0 }}>
              Get notified
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#444", fontSize: "18px", cursor: "pointer", padding: 0, lineHeight: 1 }}>
            ✕
          </button>
        </div>

        <p style={{ color: "#555", fontSize: "11px", marginBottom: "20px", lineHeight: 1.6 }}>
          Email when new listings match:
          <span style={{ display: "block", color: "#888", marginTop: "5px", fontStyle: "italic" }}>
            "{search.label}"
          </span>
        </p>

        {success ? (
          <div style={{
            background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
            borderRadius: "6px", padding: "16px",
            color: "#4ade80", fontSize: "12px", textAlign: "center", lineHeight: 1.6,
          }}>
            ✓ Alert created!<br />
            <span style={{ color: "#555", fontSize: "10px" }}>You'll get an email when new listings appear.</span>
          </div>
        ) : (
          <>
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="your@email.com"
              autoFocus
              style={iStyle}
              onFocus={e => e.target.style.borderColor = "#f5a623"}
              onBlur={e => e.target.style.borderColor = error ? "rgba(255,107,107,0.5)" : "#2a2a3a"}
            />
            {error && <p style={{ color: "#ff6b6b", fontSize: "10px", margin: "6px 0 0 0" }}>⚠ {error}</p>}

            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  flex: 1, padding: "11px",
                  background: loading ? "#1a1a24" : "#f5a623",
                  color: loading ? "#555" : "#0d0d14",
                  border: "none", borderRadius: "6px",
                  fontSize: "11px", fontFamily: "monospace",
                  fontWeight: "800", letterSpacing: "0.1em",
                  cursor: loading ? "not-allowed" : "pointer", transition: "all 0.2s",
                }}
              >
                {loading ? "⟳ Creating..." : "🔔 Create Alert"}
              </button>
              <button
                onClick={onClose}
                style={{
                  padding: "11px 16px", background: "none",
                  border: "1px solid #2a2a3a", borderRadius: "6px",
                  color: "#555", fontSize: "11px", fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>

            <p style={{ color: "#333", fontSize: "9px", marginTop: "14px", lineHeight: 1.6 }}>
              Alerts are checked by calling <code style={{ color: "#555" }}>GET /api/alerts/check</code> — set up a cron job or call it manually. Requires a Resend API key.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "score",    label: "Best match"    },
  { value: "newest",   label: "Newest first"  },
  { value: "upvotes",  label: "Most upvoted"  },
];

const LS_KEY         = "savedSearches";
const LAST_VISIT_KEY = "lastVisit";
const MAX_SAVED      = 10;

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}

function loadFromLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function loadLastVisit() {
  const v = localStorage.getItem(LAST_VISIT_KEY);
  // First ever visit: treat anything from last 24 h as new
  return v ? parseInt(v, 10) : Math.floor(Date.now() / 1000) - 86400;
}

function generateLabel({ bhk, area, budget, keywords }) {
  const parts = [];
  if (bhk && bhk !== "any") parts.push(bhk.replace(/(\d)(BHK)/i, "$1 $2"));
  if (area)     parts.push(area.trim());
  if (budget)   parts.push(`under ${budget.trim()}`);
  if (keywords) parts.push(keywords.trim());
  return parts.length ? parts.join(" · ") : "All Bangalore listings";
}

function sortedPosts(posts, sortBy) {
  const copy = [...posts];
  if (sortBy === "score" || sortBy === "quality") return copy.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
  if (sortBy === "newest")  return copy.sort((a, b) => b.created - a.created);
  if (sortBy === "upvotes") return copy.sort((a, b) => (b.score || 0) - (a.score || 0));
  return copy;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
// Renders via a portal at document.body so it's never affected by parent
// transforms (e.g. the card's translateX on hover which breaks position:fixed).
function Tooltip({ content, children, maxWidth = 260 }) {
  const [visible, setVisible] = useState(false);
  const [pos,     setPos]     = useState({ top: 0, left: 0 });

  const show = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - maxWidth - 12);
    setPos({ top: rect.bottom + 8, left });
    setVisible(true);
  };

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && createPortal(
        <div style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          zIndex: 99999,
          maxWidth,
          background: "#12121e",
          border: "1px solid #2a2a3a",
          borderRadius: "8px",
          padding: "12px 14px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#888",
          lineHeight: "1.7",
          pointerEvents: "none",
        }}>
          {content}
        </div>,
        document.body
      )}
    </span>
  );
}

// ─── Score breakdown (mirrors backend score_post logic) ───────────────────────
const _BK_LOCALITIES = [
  "indiranagar","whitefield","koramangala","hsr","bellandur","marathahalli",
  "sarjapur","btm","jayanagar","hebbal","electronic city","bannerghatta",
  "mg road","frazer town","hoodi","kr puram","domlur","madiwala","yelahanka",
  "cunningham","banaswadi","jp nagar","rajajinagar","malleswaram","yeshwanthpur",
  "panathur","varthur","brookefield","itpl","manyata","thanisandra","hennur",
  "kalyan nagar","rt nagar",
];
const _BK_BROKER = [
  "brokerage","broker fee","commission","site visit","schedule a visit",
  "book now","contact for details","call for price","multiple options",
  "many flats available","we have","our property","agent",
];
const _BK_SPAM = [
  "forward","share this","join our group","whatsapp us",
  "visit our website","call us","dm for more",
];

function buildScoreBreakdown(post) {
  const text = `${post.title||""} ${post.body||""} ${post.selftext||""}`.toLowerCase();
  const rows = [];

  if (post.price)   rows.push({ pts: +20, label: "Has price" });
  if (post.contact) rows.push({ pts: +20, label: "Has contact number" });
  if (_BK_LOCALITIES.some(l => text.includes(l))) rows.push({ pts: +15, label: "Bangalore locality found" });
  if (["1bhk","2bhk","3bhk","1 bhk","2 bhk","3 bhk","studio","1rk"].some(b => text.includes(b)))
    rows.push({ pts: +15, label: "BHK type mentioned" });
  if (["furnished","semi-furnished","unfurnished"].some(f => text.includes(f)))
    rows.push({ pts: +5, label: "Furnished status" });
  if (["deposit","advance","security"].some(d => text.includes(d)))
    rows.push({ pts: +5, label: "Deposit info" });

  const age = Date.now() / 1000 - (post.created || 0);
  if (age < 86400)       rows.push({ pts: +20, label: "Posted today" });
  else if (age < 604800) rows.push({ pts: +10, label: "Posted this week" });
  else if (age < 2592000) rows.push({ pts: +5,  label: "Posted this month" });

  if (post.source === "reddit") {
    if ((post.score || 0) > 10)      rows.push({ pts: +10, label: "High upvotes" });
    else if ((post.score || 0) > 3)  rows.push({ pts: +5,  label: "Some upvotes" });
    if ((post.comments || 0) > 5)    rows.push({ pts: +5,  label: "Active comments" });
  }

  if (post.source === "telegram") {
    const bl = (post.body || "").length;
    if (bl > 200)      rows.push({ pts: +10, label: "Detailed message" });
    else if (bl > 100) rows.push({ pts: +5,  label: "Medium-length message" });
    else if (bl < 30)  rows.push({ pts: -10, label: "Very short message" });
    if (post.no_brokerage) rows.push({ pts: +15, label: "No-brokerage confirmed" });
  }

  if (post.source === "nobroker") {
    rows.push({ pts: +15, label: "NoBroker trust bonus (no-brokerage)" });
    return rows;
  }

  const brokerHits = _BK_BROKER.filter(s => text.includes(s));
  if (brokerHits.length >= 2)      rows.push({ pts: -20, label: `Broker signals (${brokerHits.slice(0,2).join(", ")})` });
  else if (brokerHits.length === 1) rows.push({ pts: -10, label: `Broker signal ("${brokerHits[0]}")` });

  if (_BK_SPAM.some(s => text.includes(s))) rows.push({ pts: -15, label: "Spam signal detected" });

  return rows;
}

function ScoreBadge({ score, post }) {
  const color =
    score >= 70 ? "#4ade80" :
    score >= 40 ? "#facc15" :
                  "#6b7280";
  const bg =
    score >= 70 ? "rgba(74,222,128,0.12)" :
    score >= 40 ? "rgba(250,204,21,0.12)" :
                  "rgba(107,114,128,0.12)";

  const badge = (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: "28px", height: "20px",
      background: bg, color,
      fontSize: "10px", fontFamily: "monospace", fontWeight: 700,
      padding: "0 6px", borderRadius: "4px",
      border: `1px solid ${color}33`,
      flexShrink: 0, cursor: post ? "help" : "default",
    }}>
      {score}
    </span>
  );

  if (!post) return badge;

  const rows = buildScoreBreakdown(post);
  const tooltipContent = (
    <div>
      <div style={{ color: "#e8e4d8", fontWeight: 700, marginBottom: "8px", fontSize: "10px", letterSpacing: "0.05em" }}>
        Score breakdown — {score}/100
      </div>
      {rows.length === 0 ? (
        <div style={{ color: "#555" }}>No signals matched</div>
      ) : rows.map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "16px", color: r.pts > 0 ? "#6ee09a" : "#f87171" }}>
          <span style={{ color: "#888" }}>{r.label}</span>
          <span style={{ fontWeight: 700, flexShrink: 0 }}>{r.pts > 0 ? `+${r.pts}` : r.pts}</span>
        </div>
      ))}
      <div style={{ borderTop: "1px solid #2a2a3a", marginTop: "8px", paddingTop: "6px", display: "flex", justifyContent: "space-between", color: "#e8e4d8" }}>
        <span>Total</span>
        <span style={{ color, fontWeight: 700 }}>{score}</span>
      </div>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} maxWidth={280}>
      {badge}
    </Tooltip>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={{
      position: "fixed", bottom: "24px", right: "24px", zIndex: 9999,
      background: "#1e1e2e", border: "1px solid #2a2a3a",
      borderRadius: "8px", padding: "10px 16px",
      color: "#e8e4d8", fontSize: "12px", fontFamily: "monospace",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      animation: "toastIn 0.18s ease",
      pointerEvents: "none",
    }}>
      {message}
    </div>
  );
}

export default function App() {
  const [area,           setArea]           = useState("");
  const [bhk,            setBhk]            = useState("any");
  const [budget,         setBudget]         = useState("");
  const [keywords,       setKeywords]       = useState("");
  const [sortBy,         setSortBy]         = useState("score");
  const [minScore,       setMinScore]       = useState(20);
  const [sources,        setSources]        = useState({ reddit: true, telegram: true, nobroker: true });
  const [posts,          setPosts]          = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState("");
  const [meta,           setMeta]           = useState(null);
  const [searched,       setSearched]       = useState(false);
  const [savedSearches,  setSavedSearches]  = useState(loadSaved);
  const [savedPanelOpen, setSavedPanelOpen] = useState(false);
  const [justSaved,      setJustSaved]      = useState(false);
  const [lastVisit]                         = useState(loadLastVisit);
  const [savedListings,  setSavedListings]  = useState(() => loadFromLS("savedListings", []));
  const [hiddenPosts,    setHiddenPosts]    = useState(() => new Set(loadFromLS("hiddenPosts", [])));
  const [activeTab,      setActiveTab]      = useState("results");
  const [viewMode,       setViewMode]       = useState("grid");
  const [page,           setPage]           = useState(1);
  const [toast,          setToast]          = useState(null);
  const [alertModal,     setAlertModal]     = useState(null); // saved-search object | null
  const toastTimer                          = useRef(null);

  // Reset to page 1 whenever new search results arrive
  useEffect(() => { setPage(1); }, [posts]);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };

  const handleSaveListing = (post) => {
    setSavedListings(prev => {
      const exists  = prev.some(p => p.id === post.id);
      const updated = exists ? prev.filter(p => p.id !== post.id) : [post, ...prev];
      localStorage.setItem("savedListings", JSON.stringify(updated));
      return updated;
    });
  };

  const handleHidePost = (id) => {
    setHiddenPosts(prev => {
      const updated = new Set(prev);
      updated.add(id);
      localStorage.setItem("hiddenPosts", JSON.stringify([...updated]));
      return updated;
    });
  };

  const handleClearSavedListings = () => {
    setSavedListings([]);
    localStorage.removeItem("savedListings");
    showToast("Cleared all saved listings");
  };

  const doSearch = async ({ area: a, bhk: b, budget: bu, keywords: kw, sources: src, sort: s, minScore: ms }) => {
    setLoading(true);
    setError("");
    setPosts([]);
    setMeta(null);
    setSearched(true);

    const activeSources = src || sources;
    const sourceList = Object.entries(activeSources)
      .filter(([, on]) => on)
      .map(([id]) => id)
      .join(",") || "reddit";

    try {
      const params = new URLSearchParams({
        bhk: b,
        sources: sourceList,
        sort:      s  ?? sortBy,
        min_score: ms ?? minScore,
        ...(a  ? { area: a }      : {}),
        ...(bu ? { budget: bu }   : {}),
        ...(kw ? { keywords: kw } : {}),
        limit: 50,
      });

      const res  = await fetch(`${API_BASE}/api/search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setPosts(data.posts);
      setMeta({ query: data.query, subreddits: data.subreddits, total: data.total });
      localStorage.setItem(LAST_VISIT_KEY, Math.floor(Date.now() / 1000));
    } catch (err) {
      setError(err.message);
    }

    setLoading(false);
  };

  const handleSearch = () => doSearch({ area, bhk, budget, keywords, sort: sortBy, minScore });

  const handleSave = () => {
    const entry = {
      id:      Date.now().toString(),
      label:   generateLabel({ bhk, area, budget, keywords }),
      bhk, area, budget, keywords,
      savedAt: Date.now(),
    };
    const updated = [entry, ...savedSearches].slice(0, MAX_SAVED);
    setSavedSearches(updated);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
    setSavedPanelOpen(true);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  };

  const handleDeleteSaved = (id) => {
    const updated = savedSearches.filter(s => s.id !== id);
    setSavedSearches(updated);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
  };

  const handleRunSaved = (s) => {
    setArea(s.area || "");
    setBhk(s.bhk || "any");
    setBudget(s.budget || "");
    setKeywords(s.keywords || "");
    doSearch({ area: s.area || "", bhk: s.bhk || "any", budget: s.budget || "", keywords: s.keywords || "" });
  };

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: "1px solid #2a2a3a", borderRadius: "6px",
    padding: "11px 14px", color: "#e8e4d8",
    fontSize: "13px", fontFamily: "monospace",
    outline: "none", boxSizing: "border-box", transition: "border-color 0.2s",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d14", color: "#e8e4d8", fontFamily: "monospace" }}>
      <div style={{
        position: "fixed", inset: 0,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px)",
        pointerEvents: "none", zIndex: 0,
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "1380px", margin: "0 auto", padding: "40px 32px" }}>

        {/* Header */}
        <div style={{ marginBottom: "36px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <div style={{
              width: "7px", height: "7px", borderRadius: "50%",
              background: "#f5a623", boxShadow: "0 0 8px #f5a623",
              animation: "pulse 2s infinite",
            }} />
            <span style={{ fontSize: "9px", color: "#f5a623", letterSpacing: "0.2em", opacity: 0.7 }}>
              REDDIT HOUSING SCANNER
            </span>
          </div>
          <h1 style={{
            fontSize: "30px", fontFamily: "'Georgia', serif",
            fontWeight: "normal", color: "#e8e4d8", margin: "0 0 6px 0",
          }}>
            Find Your Next Place in Bangalore
          </h1>
          <p style={{ color: "#444", fontSize: "12px", margin: 0 }}>
            Searches {SUBREDDITS.join(", ")} live. No API keys required.
          </p>
        </div>

        {/* Saved Searches Panel */}
        {savedSearches.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <button
              onClick={() => setSavedPanelOpen(o => !o)}
              style={{
                background: "none", border: "1px solid #2a2a3a",
                borderRadius: "6px", color: "#f5a623",
                fontSize: "10px", fontFamily: "monospace",
                padding: "7px 14px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "8px",
                letterSpacing: "0.1em",
              }}
            >
              <span>★ SAVED SEARCHES</span>
              <span style={{
                background: "rgba(245,166,35,0.2)", color: "#f5a623",
                borderRadius: "10px", padding: "1px 7px", fontSize: "9px",
              }}>{savedSearches.length}</span>
              <span style={{ opacity: 0.5, fontSize: "9px" }}>{savedPanelOpen ? "▲" : "▼"}</span>
            </button>

            {savedPanelOpen && (
              <div style={{
                marginTop: "10px",
                background: "rgba(255,255,255,0.015)",
                border: "1px solid #1a1a24",
                borderRadius: "8px", padding: "14px",
                display: "flex", flexDirection: "column", gap: "8px",
              }}>
                {savedSearches.map(s => (
                  <div key={s.id} style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid #2a2a3a", borderRadius: "6px",
                    padding: "8px 12px",
                    flexWrap: "wrap",
                  }}>
                    <span style={{
                      flex: 1, color: "#c8c4bc", fontSize: "11px",
                      fontFamily: "monospace", minWidth: "120px",
                    }}>
                      {s.label}
                    </span>
                    <span style={{ color: "#3a3a4a", fontSize: "9px", fontFamily: "monospace" }}>
                      {new Date(s.savedAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => { handleRunSaved(s); setSavedPanelOpen(false); }}
                      style={{
                        background: "rgba(245,166,35,0.15)", border: "1px solid rgba(245,166,35,0.3)",
                        color: "#f5a623", fontSize: "9px", fontFamily: "monospace",
                        padding: "3px 10px", borderRadius: "4px", cursor: "pointer",
                        letterSpacing: "0.05em",
                      }}
                    >▶ Run</button>
                    <button
                      onClick={() => setAlertModal(s)}
                      title="Create email alert for this search"
                      style={{
                        background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)",
                        color: "#4ade80", fontSize: "9px", fontFamily: "monospace",
                        padding: "3px 10px", borderRadius: "4px", cursor: "pointer",
                        letterSpacing: "0.05em",
                      }}
                    >🔔 Alert</button>
                    <button
                      onClick={() => handleDeleteSaved(s.id)}
                      style={{
                        background: "none", border: "none",
                        color: "#3a3a4a", fontSize: "12px",
                        cursor: "pointer", padding: "2px 4px", lineHeight: 1,
                        transition: "color 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "#ff6b6b"}
                      onMouseLeave={e => e.currentTarget.style.color = "#3a3a4a"}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Form */}
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(245,166,35,0.15)",
          borderRadius: "10px", padding: "24px", marginBottom: "28px",
        }}>
          {/* Row 1: Area | Type | Budget | Keywords — 4 columns */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "9px", color: "#f5a623", letterSpacing: "0.15em", marginBottom: "7px" }}>
                AREA <span style={{ opacity: 0.4 }}>(optional)</span>
              </label>
              <input
                value={area}
                onChange={e => setArea(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Koramangala, Indiranagar, Whitefield..."
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#f5a623"}
                onBlur={e => e.target.style.borderColor = "#2a2a3a"}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "9px", color: "#f5a623", letterSpacing: "0.15em", marginBottom: "7px" }}>TYPE</label>
              <select value={bhk} onChange={e => setBhk(e.target.value)}
                style={{ ...inputStyle, background: "#0d0d14", cursor: "pointer" }}>
                <option value="any">Any</option>
                <option value="1BHK">1 BHK</option>
                <option value="2BHK">2 BHK</option>
                <option value="3BHK">3 BHK</option>
                <option value="PG">PG / Hostel</option>
                <option value="flatmate">Flatmate</option>
                <option value="studio">Studio</option>
                <option value="villa">Villa / Independent</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "9px", color: "#f5a623", letterSpacing: "0.15em", marginBottom: "7px" }}>BUDGET</label>
              <input value={budget} onChange={e => setBudget(e.target.value)}
                placeholder="20000, under 30k..."
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#f5a623"}
                onBlur={e => e.target.style.borderColor = "#2a2a3a"}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "9px", color: "#f5a623", letterSpacing: "0.15em", marginBottom: "7px" }}>KEYWORDS</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="furnished, parking..."
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#f5a623"}
                onBlur={e => e.target.style.borderColor = "#2a2a3a"}
              />
            </div>
          </div>

          {/* Sort + Quality filter row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "9px", color: "#f5a623", letterSpacing: "0.15em", marginBottom: "7px" }}>SORT BY</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={{ ...inputStyle, background: "#0d0d14", cursor: "pointer" }}
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "9px", color: "#f5a623", letterSpacing: "0.15em", marginBottom: "7px" }}>
                <span>QUALITY FILTER —{" "}
                  <span style={{ color: minScore >= 40 ? "#22c55e" : minScore >= 20 ? "#f59e0b" : "#4b5563", fontWeight: 700 }}>
                    {minScore >= 40 ? "High" : minScore >= 20 ? "Medium" : "Low"}
                  </span>
                  <span style={{ color: "#3a3a4a", marginLeft: "6px" }}>({minScore}+)</span>
                </span>
                <Tooltip maxWidth={300} content={
                  <div>
                    <div style={{ color: "#e8e4d8", fontWeight: 700, marginBottom: "8px" }}>How scores are calculated</div>
                    {[
                      ["Price found",              "+20"],
                      ["Contact number",            "+20"],
                      ["Recency (today)",           "+20"],
                      ["Bangalore locality",        "+15"],
                      ["BHK type mentioned",        "+15"],
                      ["NoBroker trust bonus",      "+15"],
                      ["Recency (this week)",       "+10"],
                      ["Detailed TG message",       "+10"],
                      ["Reddit upvotes >10",        "+10"],
                      ["Furnished status",          "+5"],
                      ["Deposit info",              "+5"],
                      ["Reddit comments >5",        "+5"],
                      ["Broker signals (×1)",       "−10"],
                      ["Spam signals",              "−15"],
                      ["Broker signals (×2+)",      "−20"],
                    ].map(([label, pts]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "20px", marginBottom: "2px" }}>
                        <span style={{ color: "#777" }}>{label}</span>
                        <span style={{ fontWeight: 700, flexShrink: 0, color: pts.startsWith("+") ? "#6ee09a" : "#f87171" }}>{pts}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid #2a2a3a", marginTop: "8px", paddingTop: "6px", color: "#555", lineHeight: 1.6 }}>
                      Score clamped 0–100. Filter hides posts below the threshold.
                    </div>
                  </div>
                }>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: "13px", height: "13px", borderRadius: "50%",
                    border: "1px solid #3a3a4a", color: "#555",
                    fontSize: "8px", cursor: "help", flexShrink: 0,
                    fontWeight: 700, letterSpacing: 0,
                  }}>i</span>
                </Tooltip>
              </label>
              <input
                type="range" min={0} max={60} step={10}
                value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#f5a623", cursor: "pointer", marginTop: "6px" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px", color: "#3a3a4a", fontFamily: "monospace", marginTop: "3px" }}>
                <span>Off</span><span>Low</span><span>Med</span><span>High</span>
              </div>
            </div>
          </div>

          {/* Source toggles */}
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "9px", color: "#f5a623", letterSpacing: "0.15em", marginBottom: "7px" }}>
              SOURCES
            </label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {SOURCE_DEFS.map(s => {
                const active = sources[s.id];
                return (
                  <button
                    key={s.id}
                    onClick={() => setSources(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "6px",
                      padding: "7px 14px", borderRadius: "6px",
                      border: `1px solid ${active ? s.color + "66" : "#2a2a3a"}`,
                      background: active ? `${s.color}18` : "rgba(255,255,255,0.02)",
                      color: active ? s.color : "#444",
                      fontSize: "10px", fontFamily: "monospace",
                      cursor: "pointer", transition: "all 0.15s",
                      letterSpacing: "0.05em",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = s.color + "88";
                      e.currentTarget.style.color = s.color;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = active ? s.color + "66" : "#2a2a3a";
                      e.currentTarget.style.color = active ? s.color : "#444";
                    }}
                  >
                    {s.icon} {s.label}
                    {active && <span style={{ opacity: 0.6, fontSize: "9px" }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={handleSearch}
              disabled={loading}
              style={{
                flex: 1, padding: "13px",
                background: loading ? "#1a1a24" : "#f5a623",
                color: loading ? "#555" : "#0d0d14",
                border: "none", borderRadius: "6px",
                fontSize: "11px", fontFamily: "monospace",
                fontWeight: "800", letterSpacing: "0.15em",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {loading ? "⟳  SEARCHING..." : "▶  SCAN FOR LISTINGS"}
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              title="Save this search"
              style={{
                padding: "13px 18px",
                background: justSaved ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.04)",
                color: justSaved ? "#4ade80" : "#f5a623",
                border: `1px solid ${justSaved ? "rgba(74,222,128,0.4)" : "rgba(245,166,35,0.3)"}`,
                borderRadius: "6px",
                fontSize: "14px", fontFamily: "monospace",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.2s", flexShrink: 0,
              }}
            >
              {justSaved ? "✓" : "★"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(255,60,60,0.07)", border: "1px solid rgba(255,60,60,0.25)",
            borderRadius: "6px", padding: "12px 16px",
            color: "#ff6b6b", fontSize: "12px", marginBottom: "20px",
          }}>⚠ {error}</div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <div style={{
              display: "inline-block", width: "28px", height: "28px",
              border: "2px solid #1a1a24", borderTopColor: "#f5a623",
              borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: "14px",
            }} />
            <div style={{ color: "#444", fontSize: "11px" }}>
              Searching Reddit{area ? ` for "${area}"` : " for Bangalore listings"}...
            </div>
          </div>
        )}

        {/* Tab bar */}
        {!loading && (searched || savedListings.length > 0) && (
          <div style={{
            display: "flex", gap: "0",
            borderBottom: "1px solid #1a1a24", marginBottom: "20px",
          }}>
            {[
              { id: "results", label: `Search Results${posts.length > 0 ? ` (${posts.filter(p => !hiddenPosts.has(p.id)).length})` : ""}` },
              { id: "saved",   label: `💾 Saved Listings${savedListings.length > 0 ? ` (${savedListings.length})` : ""}` },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${activeTab === tab.id ? "#f5a623" : "transparent"}`,
                  color: activeTab === tab.id ? "#f5a623" : "#444",
                  fontSize: "11px", fontFamily: "monospace",
                  padding: "8px 16px", cursor: "pointer",
                  letterSpacing: "0.05em",
                  transition: "all 0.15s",
                  marginBottom: "-1px",
                }}
                onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.color = "#888"; }}
                onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.color = "#444"; }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Results tab */}
        {!loading && searched && activeTab === "results" && (
          <>
            {meta && meta.query && (
              <div style={{
                background: "rgba(255,255,255,0.015)", border: "1px solid #1a1a24",
                borderRadius: "4px", padding: "10px 14px", marginBottom: "16px",
                fontSize: "10px", color: "#444",
              }}>
                <span style={{ color: "#555" }}>query:</span>{" "}
                <span style={{ fontStyle: "italic", color: "#666" }}>{meta.query}</span>
                {sources.reddit && meta.subreddits && meta.subreddits.length > 0 && (
                  <>
                    <br />
                    <span style={{ color: "#555" }}>subreddits: </span>
                    {meta.subreddits.map(s => (
                      <span key={s} style={{ color: "#555", marginRight: "8px" }}>r/{s}</span>
                    ))}
                  </>
                )}
              </div>
            )}

            {posts.length > 0 ? (() => {
              const sorted   = sortedPosts(posts, sortBy).filter(p => !hiddenPosts.has(p.id));
              const newCount      = sorted.filter(p => p.created > lastVisit).length;
              const redditCount   = sorted.filter(p => (p.source || "reddit") === "reddit").length;
              const telegramCount = sorted.filter(p => p.source === "telegram").length;
              const nobrokerCount = sorted.filter(p => p.source === "nobroker").length;
              const multiSource   = (redditCount > 0 ? 1 : 0) + (telegramCount > 0 ? 1 : 0) + (nobrokerCount > 0 ? 1 : 0) > 1;
              return (
                <>
                  {newCount > 0 && viewMode !== "map" && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      background: "rgba(74,222,128,0.08)",
                      border: "1px solid rgba(74,222,128,0.2)",
                      borderRadius: "6px", padding: "10px 14px", marginBottom: "14px",
                      color: "#4ade80", fontSize: "11px", fontFamily: "monospace",
                    }}>
                      <span>✨</span>
                      <span><strong>{newCount}</strong> new listing{newCount !== 1 ? "s" : ""} since your last visit</span>
                    </div>
                  )}
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: "14px", paddingBottom: "10px", borderBottom: "1px solid #1a1a24",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <span style={{ color: "#f5a623", fontSize: "13px" }}>
                        {sorted.length} listing{sorted.length !== 1 ? "s" : ""}
                      </span>
                      {multiSource && (
                        <span style={{ color: "#555", fontSize: "10px", fontFamily: "monospace" }}>
                          —{" "}
                          {redditCount > 0 && <span style={{ color: "#ff4500" }}>🟠 {redditCount} Reddit{"  "}</span>}
                          {telegramCount > 0 && <span style={{ color: "#229ed9" }}>✈️ {telegramCount} Telegram{"  "}</span>}
                          {nobrokerCount > 0 && <span style={{ color: "#e63946" }}>🔴 {nobrokerCount} NoBroker</span>}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {/* List / Map toggle */}
                      <div style={{
                        display: "flex", background: "#111118",
                        border: "1px solid #2a2a3a", borderRadius: "6px", padding: "2px",
                      }}>
                        {[["list", "☰ List"], ["grid", "▦ Grid"], ["map", "🗺 Map"]].map(([id, label]) => (
                          <button
                            key={id}
                            onClick={() => setViewMode(id)}
                            style={{
                              background: viewMode === id ? "#2a2a3a" : "none",
                              border: "none",
                              color: viewMode === id ? "#f5a623" : "#555",
                              fontSize: "10px", fontFamily: "monospace",
                              padding: "4px 11px", borderRadius: "4px",
                              cursor: "pointer", transition: "all 0.15s",
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {viewMode !== "map" && (
                        <span style={{ color: "#3a3a4a", fontSize: "9px", letterSpacing: "0.1em", fontFamily: "monospace" }}>
                          {SORT_OPTIONS.find(o => o.value === sortBy)?.label.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  {viewMode === "map" ? (
                    <MapView posts={sorted} />
                  ) : viewMode === "list" ? (
                    // Single-column detailed list
                    sorted.map((post, i) => (
                      <PostCard
                        key={post.id} post={post} index={i} lastVisit={lastVisit}
                        isSaved={savedListings.some(p => p.id === post.id)}
                        onSave={handleSaveListing}
                        onHide={handleHidePost}
                        onToast={showToast}
                      />
                    ))
                  ) : (() => {
                    // 4-column tile grid with pagination
                    const totalPages = Math.ceil(sorted.length / TILES_PER_PAGE);
                    const paginated  = sorted.slice((page - 1) * TILES_PER_PAGE, page * TILES_PER_PAGE);
                    return (
                      <>
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, 1fr)",
                          gap: "14px", marginBottom: "8px",
                        }}>
                          {paginated.map(post => (
                            <PostTile
                              key={post.id} post={post} lastVisit={lastVisit}
                              isSaved={savedListings.some(p => p.id === post.id)}
                              onSave={handleSaveListing}
                              onHide={handleHidePost}
                              onToast={showToast}
                            />
                          ))}
                        </div>
                        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPage={setPage} />}
                      </>
                    );
                  })()}
                </>
              );
            })() : (
              <div style={{ textAlign: "center", padding: "50px 0", color: "#333", fontSize: "13px" }}>
                No listings found. Try a different area or remove some filters.
              </div>
            )}
          </>
        )}

        {/* Saved listings tab */}
        {!loading && activeTab === "saved" && (
          <>
            {savedListings.length > 0 ? (
              <>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: "14px", paddingBottom: "10px", borderBottom: "1px solid #1a1a24",
                }}>
                  <span style={{ color: "#f5a623", fontSize: "13px" }}>
                    {savedListings.length} saved listing{savedListings.length !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={handleClearSavedListings}
                    style={{
                      background: "none", border: "1px solid #3a3a4a",
                      borderRadius: "4px", color: "#666",
                      fontSize: "9px", fontFamily: "monospace",
                      padding: "4px 10px", cursor: "pointer",
                      letterSpacing: "0.05em", transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#ff6b6b"; e.currentTarget.style.borderColor = "rgba(255,107,107,0.4)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "#666"; e.currentTarget.style.borderColor = "#3a3a4a"; }}
                  >
                    Clear all saved
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" }}>
                  {savedListings.map(post => (
                    <PostTile
                      key={post.id} post={post} lastVisit={lastVisit}
                      isSaved={true}
                      onSave={handleSaveListing}
                      onHide={handleHidePost}
                      onToast={showToast}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "50px 0", color: "#333", fontSize: "13px" }}>
                No saved listings yet. Hover a card and click 💾 Save.
              </div>
            )}
          </>
        )}

      </div>

      <Toast message={toast} />

      {alertModal && (
        <AlertModal
          search={alertModal}
          onClose={() => setAlertModal(null)}
          onCreated={() => { setAlertModal(null); showToast("🔔 Alert created! You'll get emails for new listings."); }}
        />
      )}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        select option { background: #0d0d14; }
        input::placeholder { color: #2a2a3a; }

        /* Dark Leaflet popup */
        .dark-popup .leaflet-popup-content-wrapper {
          background: #1a1a2e !important;
          border: 1px solid #2a2a3a !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 24px rgba(0,0,0,0.7) !important;
          padding: 0 !important;
        }
        .dark-popup .leaflet-popup-content {
          margin: 12px 14px !important;
        }
        .dark-popup .leaflet-popup-tip {
          background: #1a1a2e !important;
        }
        .dark-popup .leaflet-popup-close-button {
          color: #555 !important;
          font-size: 16px !important;
          padding: 5px 8px !important;
          top: 2px !important;
          right: 2px !important;
        }
        .dark-popup .leaflet-popup-close-button:hover {
          color: #e8e4d8 !important;
          background: none !important;
        }
        .leaflet-container {
          background: #0d0d14;
          font-family: monospace;
        }
      `}</style>
    </div>
  );
}
