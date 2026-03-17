import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { useTheme } from "./ThemeContext";
import { BackgroundPattern } from "./components/BackgroundPattern";

const API_BASE = import.meta.env.VITE_API_URL || "";
const SUBREDDITS = ["r/bangalore", "r/bengaluru", "r/indianrealestate", "r/bangalorerentals", "r/FlatandFlatmatesBLR", "r/FlatmatesinBangalore"];

const SOURCE_DEFS = [
  { id: "reddit",   label: "Reddit",      icon: "🟠", color: "#ff4500" },
  { id: "telegram", label: "Telegram",    icon: "✈️",  color: "#229ed9" },
  { id: "nobroker", label: "NoBroker",    icon: "🔴", color: "#e63946" },
  { id: "housing",  label: "Housing.com", icon: "🏠", color: "#7c3aed" },
];

const BANGALORE_AREAS = [
  "Indiranagar", "Whitefield", "Koramangala", "HSR Layout", "HSR",
  "Bellandur", "Marathahalli", "Sarjapur Road", "Sarjapur", "BTM Layout", "BTM",
  "Jayanagar", "Hebbal", "Yelahanka", "Electronic City", "Bannerghatta",
  "Cunningham Road", "MG Road", "Frazer Town", "Banaswadi", "Hoodi",
  "KR Puram", "Domlur", "Madiwala", "Bommanahalli", "Brookefield",
  "Kadubeesanahalli", "Panathur", "Varthur", "Thubarahalli", "Kadugodi",
  "JP Nagar", "Banashankari", "Rajajinagar", "Malleshwaram", "Yeshwanthpur",
  "Nagawara", "HBR Layout", "CV Raman Nagar", "Old Airport Road",
  "ITPL", "Manyata", "Thanisandra", "Hennur", "Kalyan Nagar", "RT Nagar",
  "Ejipura", "Ulsoor", "Basavanagudi", "Sadashivanagar", "Vijayanagar", "Kengeri",
];

const LOCALITY_COORDS = {
  "Indiranagar":      [12.9784, 77.6408],
  "Whitefield":       [12.9698, 77.7499],
  "Koramangala":      [12.9352, 77.6245],
  "HSR Layout":       [12.9116, 77.6389],
  "HSR":              [12.9116, 77.6389],
  "Bellandur":        [12.9257, 77.6761],
  "Marathahalli":     [12.9591, 77.6974],
  "Sarjapur Road":    [12.9087, 77.6950],
  "Sarjapur":         [12.9087, 77.6950],
  "BTM Layout":       [12.9165, 77.6101],
  "BTM":              [12.9165, 77.6101],
  "Jayanagar":        [12.9299, 77.5820],
  "Hebbal":           [13.0353, 77.5947],
  "Yelahanka":        [13.1007, 77.5963],
  "Electronic City":  [12.8399, 77.6770],
  "Bannerghatta":     [12.8634, 77.5855],
  "Cunningham Road":  [12.9812, 77.5958],
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
  "ITPL":             [12.9854, 77.7308],
  "Manyata":          [13.0467, 77.6210],
  "Thanisandra":      [13.0590, 77.6350],
  "Hennur":           [13.0440, 77.6480],
  "Kalyan Nagar":     [13.0254, 77.6400],
  "RT Nagar":         [13.0210, 77.5970],
  "Ejipura":          [12.9420, 77.6220],
  "Ulsoor":           [12.9810, 77.6200],
  "Basavanagudi":     [12.9420, 77.5730],
  "Sadashivanagar":   [13.0060, 77.5810],
  "Vijayanagar":      [12.9710, 77.5330],
  "Kengeri":          [12.9070, 77.4850],
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
      border: `1px solid ${color}33`,
      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
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
      background: `${def.color}20`,
      color: def.color,
      border: `1px solid ${def.color}40`,
      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
      fontSize: "9px", fontFamily: "monospace",
      padding: "2px 7px", borderRadius: "5px",
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
  const isHousing       = post.source === "housing";

  // For Reddit: extract from text. For Telegram/NoBroker/Housing: prefer server-provided fields.
  const bodyText = (isTelegram || isNoBroker || isHousing) ? (post.body || "") : (post.selftext || "");
  const { bhk: clientBhk, locality: clientLocality, price: clientPrice, furnished: clientFurnished, phone: clientPhone } =
    extractListingInfo(post.title, bodyText);

  const displayPrice = (isTelegram || isNoBroker || isHousing)
    ? formatPriceValue(post.price, post.price_formatted)
    : (clientPrice || post.price);
  const displayContact  = (isNoBroker || isHousing) ? null : (isTelegram ? post.contact : (clientPhone || post.contact));
  const displayBhk      = (isNoBroker || isHousing) ? post.bhk      : (isTelegram ? (post.bhk      || clientBhk)      : clientBhk);
  const displayLocality = (isNoBroker || isHousing) ? post.locality  : (isTelegram ? (post.locality || clientLocality) : clientLocality);
  const displayFurnished = (isNoBroker || isHousing) ? post.furnishing : (isTelegram ? (post.furnishing || clientFurnished) : clientFurnished);

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
      className="post-card"
      style={{
        display: "block",
        textDecoration: "none",
        background: isNewSinceVisit ? "rgba(74,222,128,0.05)" : "rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${isNewSinceVisit ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)"}`,
        borderLeft: `3px solid ${isNewSinceVisit ? "#4ade80" : isTop ? "#f5a623" : "rgba(255,255,255,0.12)"}`,
        borderRadius: "10px",
        padding: "16px 18px",
        marginBottom: "10px",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={e => {
        setHovered(true);
        e.currentTarget.style.background = isNewSinceVisit ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.07)";
        e.currentTarget.style.borderLeftColor = isNewSinceVisit ? "#4ade80" : "#f5a623";
        e.currentTarget.style.transform = "translateX(3px)";
        e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.2)";
      }}
      onMouseLeave={e => {
        setHovered(false);
        e.currentTarget.style.background = isNewSinceVisit ? "rgba(74,222,128,0.05)" : "rgba(255,255,255,0.04)";
        e.currentTarget.style.borderLeftColor = isNewSinceVisit ? "#4ade80" : isTop ? "#f5a623" : "rgba(255,255,255,0.12)";
        e.currentTarget.style.transform = "translateX(0)";
        e.currentTarget.style.boxShadow = "none";
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
        <div className="post-title" style={{ color: "#e8e4d8", fontSize: "14px", fontFamily: "'Georgia', serif", lineHeight: "1.5", flex: 1 }}>
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
          <span className="post-time" style={{ color: "#3a3a4a", fontSize: "10px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
            {isNoBroker && post.last_update_string ? post.last_update_string : timeAgo(post.created)}
          </span>
        </div>
      </div>

      {/* Telegram subtitle — only when it adds info beyond the title */}
      {isTelegram && post.subtitle &&
       post.subtitle.toLowerCase().trim() !== post.title.toLowerCase().trim() && (
        <div className="post-subtitle" style={{
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
          {displayLocality && <Pill icon="📍" label={displayLocality} bg="rgba(120,120,140,0.12)" color="#9a9ab0" />}
          {displayPrice    && <Pill icon="💰" label={String(displayPrice)} bg="rgba(34,197,94,0.15)" color="#6ee09a" />}
          {displayFurnished && <Pill icon="🛋️" label={displayFurnished} bg="rgba(168,85,247,0.15)" color="#c084fc" />}
          {isNoBroker && post.deposit_formatted && (
            <Pill icon="🔒" label={`Deposit: ${post.deposit_formatted}`} bg="rgba(120,120,140,0.1)" color="#8a8a9a" />
          )}
          {isNoBroker && post.lease_type && post.lease_type !== "ANYONE" && (
            <Pill icon="👤" label={post.lease_type.charAt(0) + post.lease_type.slice(1).toLowerCase()} bg="rgba(120,120,140,0.1)" color="#8a8a9a" />
          )}
          {isTelegram && post.deposit_text && (
            <Pill icon="🔒" label={`Deposit: ₹${post.deposit_text}`} bg="rgba(120,120,140,0.1)" color="#8a8a9a" />
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
            <span key={a} className="amenity-tag" style={{
              background: "rgba(255,255,255,0.06)", color: "#666",
              fontSize: "9px", fontFamily: "monospace",
              padding: "2px 7px", borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>{a}</span>
          ))}
          {post.amenities.length > 4 && (
            <span className="amenity-tag" style={{
              background: "rgba(255,255,255,0.06)", color: "#666",
              fontSize: "9px", fontFamily: "monospace",
              padding: "2px 7px", borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>+{post.amenities.length - 4} more</span>
          )}
        </div>
      )}

      {/* Meta — differs by source */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
        {isHousing ? (
          <>
            {post.owner_name && (
              <span style={{ color: "#7c3aed", fontSize: "10px", fontFamily: "monospace", opacity: 0.8 }}>
                Owner: {post.owner_name}
              </span>
            )}
            {post.available_from && (
              <span className="post-meta-text" style={{ color: "#666", fontSize: "10px", fontFamily: "monospace" }}>
                Available: {post.available_from}
              </span>
            )}
          </>
        ) : isNoBroker ? (
          <>
            {post.society && (
              <span style={{ color: "#e63946", fontSize: "10px", fontFamily: "monospace", opacity: 0.8 }}>
                🏢 {post.society}
              </span>
            )}
            {post.owner_name && (
              <span className="post-meta-text" style={{ color: "#666", fontSize: "10px", fontFamily: "monospace" }}>
                Owner: {post.owner_name}
              </span>
            )}
            {post.amenities && post.amenities.length > 0 && (
              <span className="post-meta-text" style={{ color: "#666", fontSize: "10px", fontFamily: "monospace" }}>
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
              <button
                onClick={e => { stop(e); window.open(post.maps_url, "_blank", "noopener,noreferrer"); }}
                style={{
                  color: "#6ee09a", fontSize: "10px", fontFamily: "monospace",
                  opacity: 0.85, background: "none", border: "none",
                  padding: 0, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: "3px",
                }}
              >
                📍 View on Maps
              </button>
            )}
          </>
        ) : (
          <>
            <span style={{ color: "#f5a623", fontSize: "10px", fontFamily: "monospace", opacity: 0.7 }}>
              r/{post.subreddit}
            </span>
            <span className="post-meta-text" style={{ color: "#666", fontSize: "10px", fontFamily: "monospace" }}>
              u/{post.author}
            </span>
            {post.flair && (
              <span className="amenity-tag" style={{
                color: "#888", fontSize: "9px", fontFamily: "monospace",
                background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: "3px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                {post.flair}
              </span>
            )}
            <span className="post-stats" style={{ color: "#666", fontSize: "10px", fontFamily: "monospace", marginLeft: "auto" }}>
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
          {isHousing ? (
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.3)",
                borderRadius: "5px", padding: "5px 11px",
                color: "#7c3aed", fontSize: "10px", fontFamily: "monospace",
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              🏠 View on Housing.com
            </a>
          ) : isNoBroker ? (
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
          {isHousing ? (
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
              📞 Contact via Housing.com ↗
            </a>
          ) : isNoBroker ? (
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
            <button
              onClick={e => { stop(e); window.open(post.maps_url, "_blank", "noopener,noreferrer"); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: "5px", padding: "5px 11px",
                color: "#4ade80", fontSize: "10px", fontFamily: "monospace",
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              📍 Maps
            </button>
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
  const isHousing       = post.source === "housing";
  const accentColor     = isHousing ? "#7c3aed" : isNoBroker ? "#e63946" : isTelegram ? "#229ed9" : "#ff4500";

  const bodyText = (isTelegram || isNoBroker || isHousing) ? (post.body || "") : (post.selftext || "");
  const { bhk: clientBhk, locality: clientLocality, price: clientPrice, furnished: clientFurnished, phone: clientPhone } =
    extractListingInfo(post.title, bodyText);
  const displayPrice = (isTelegram || isNoBroker || isHousing)
    ? formatPriceValue(post.price, post.price_formatted)
    : (clientPrice || post.price);
  const displayContact   = (isNoBroker || isHousing) ? null : (isTelegram ? post.contact : (clientPhone || post.contact));
  const displayBhk       = (isNoBroker || isHousing) ? post.bhk       : (isTelegram ? (post.bhk       || clientBhk)       : clientBhk);
  const displayLocality  = (isNoBroker || isHousing) ? post.locality   : (isTelegram ? (post.locality  || clientLocality)  : clientLocality);
  const displayFurnished = (isNoBroker || isHousing) ? post.furnishing : (isTelegram ? (post.furnishing || clientFurnished) : clientFurnished);

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
      className="post-tile"
      style={{
        display: "flex", flexDirection: "column",
        textDecoration: "none", position: "relative",
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${isNewSinceVisit ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)"}`,
        borderTop: `2px solid ${isNewSinceVisit ? "#4ade80" : accentColor}`,
        borderRadius: "16px", padding: "14px",
        minHeight: "210px", transition: "transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease",
      }}
      onMouseEnter={e => {
        setHovered(true);
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px rgba(245,166,35,0.1), inset 0 1px 0 rgba(255,255,255,0.08)";
        e.currentTarget.style.background = "rgba(255,255,255,0.07)";
        // Only change the three non-accent sides; leave borderTop alone
        e.currentTarget.style.borderLeftColor   = isNewSinceVisit ? "rgba(74,222,128,0.3)" : "rgba(245,166,35,0.25)";
        e.currentTarget.style.borderRightColor  = isNewSinceVisit ? "rgba(74,222,128,0.3)" : "rgba(245,166,35,0.25)";
        e.currentTarget.style.borderBottomColor = isNewSinceVisit ? "rgba(74,222,128,0.3)" : "rgba(245,166,35,0.25)";
      }}
      onMouseLeave={e => {
        setHovered(false);
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        e.currentTarget.style.borderLeftColor   = isNewSinceVisit ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)";
        e.currentTarget.style.borderRightColor  = isNewSinceVisit ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)";
        e.currentTarget.style.borderBottomColor = isNewSinceVisit ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)";
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
                background: `${c}18`, color: c, fontSize: "10px",
                fontFamily: "monospace", fontWeight: 700,
                padding: "2px 6px", borderRadius: "5px",
                border: `1px solid ${c}33`,
                backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
              }}>{post.quality_score}</span>
            );
          })()}
          <span className="post-time" style={{ color: "#3a3a4a", fontSize: "9px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
            {timeAgo(post.created)}
          </span>
        </div>
      </div>

      {/* Title — 3 lines max */}
      <div className="post-title" style={{
        color: "#e8e4d8", fontSize: "13px", fontFamily: "'Georgia', serif",
        lineHeight: "1.5", marginBottom: "10px", flex: 1,
        display: "-webkit-box", WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {post.title}
      </div>

      {/* Pills — priority: BHK > price > locality > furnished > badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "10px" }}>
        {displayBhk && ((isNoBroker || isHousing) && post.area_sqft)
          ? <Pill icon="🏠" label={`${displayBhk} · ${post.area_sqft} sqft`} bg="rgba(59,130,246,0.15)" color="#7eb8f7" />
          : displayBhk && <Pill icon="🏠" label={displayBhk} bg="rgba(59,130,246,0.15)" color="#7eb8f7" />}
        {displayPrice && <Pill icon="💰" label={String(displayPrice)} bg="rgba(34,197,94,0.15)" color="#6ee09a" />}
        {displayLocality
          ? <Pill icon="📍" label={displayLocality} bg="rgba(120,120,140,0.12)" color="#9a9ab0" />
          : displayFurnished && <Pill icon="🛋️" label={displayFurnished} bg="rgba(168,85,247,0.15)" color="#c084fc" />}
        {isHousing && displayFurnished && (
          <Pill icon="🛋️" label={displayFurnished} bg="rgba(168,85,247,0.15)" color="#c084fc" />
        )}
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
          {isHousing
            ? (post.address ? post.address.split(",").slice(0, 2).join(",") : "housing.com")
            : isNoBroker
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
            <span className="post-stats" style={{ color: "#666", fontSize: "9px", fontFamily: "monospace" }}>
              ↑{post.score} 💬{post.comments}
            </span>
          )}
        </div>
      </div>

      {/* Hover action overlay */}
      {hovered && (
        <div className="card-hover-overlay" style={{
          position: "absolute", inset: 0, borderRadius: "15px",
          background: "rgba(10,10,20,0.97)",
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
                  <span className="overlay-score-label" style={{ color: "#444", fontSize: "7px", letterSpacing: "0.1em" }}>SCORE</span>
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
                <div className="overlay-divider" style={{ width: "50%", borderTop: "1px solid #222230" }} />
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
      const extracted = extractListingInfo(post.title, post.selftext || post.body || "");
      const locality = post.locality || extracted.locality;
      const price = extracted.price;
      const bhk = extracted.bhk;
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
    const loc = p.locality || extractListingInfo(p.title, p.selftext || p.body || "").locality;
    return loc && LOCALITY_COORDS[loc];
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
      <div ref={containerRef} className="map-container" />
    </div>
  );
}

function ScoreInfoModal({ onClose }) {
  const POSITIVE = [
    ["+20", "Has a price listed"],
    ["+20", "Has a contact number"],
    ["+20", "Posted today"],
    ["+15", "Bangalore locality detected"],
    ["+15", "BHK type mentioned (1BHK, 2BHK…)"],
    ["+15", "NoBroker trust bonus"],
    ["+10", "Posted this week"],
    ["+10", "Detailed Telegram message (>200 chars)"],
    ["+10", "Reddit upvotes > 10"],
    [" +5", "Furnished status mentioned"],
    [" +5", "Deposit info mentioned"],
    [" +5", "Reddit comments > 5"],
  ];
  const NEGATIVE = [
    ["−10", "One broker signal detected"],
    ["−15", "Spam signal detected"],
    ["−20", "Two or more broker signals"],
  ];

  const row = (pts, label) => (
    <div key={label} style={{
      display: "flex", alignItems: "baseline", gap: "14px",
      padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}>
      <span style={{
        fontFamily: "monospace", fontSize: "12px", fontWeight: 700,
        width: "28px", textAlign: "right", flexShrink: 0,
        color: pts.startsWith("+") ? "#4ade80" : "#f87171",
      }}>{pts}</span>
      <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>{label}</span>
    </div>
  );

  return createPortal(
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
          borderRadius: "14px", padding: "28px 32px",
          maxWidth: "600px", width: "100%",
          boxShadow: "0 8px 48px rgba(0,0,0,0.8)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
          <div>
            <p style={{ color: "#f5a623", fontSize: "9px", letterSpacing: "0.2em", margin: "0 0 6px 0" }}>QUALITY SCORING</p>
            <h2 style={{ color: "#e8e4d8", fontFamily: "'Georgia',serif", fontWeight: "normal", fontSize: "20px", margin: 0 }}>
              How listings are scored
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#444", fontSize: "18px", cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
        </div>

        {/* Philosophy */}
        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", lineHeight: 1.7, marginBottom: "24px", borderBottom: "1px solid #1a1a24", paddingBottom: "20px" }}>
          Every listing is scored 0–100 based on how useful it is to someone actively searching for a flat.
          We reward completeness, freshness, and owner-direct signals — and penalise broker language and spam patterns.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: "0 28px" }}>
          {/* Positive */}
          <div>
            <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em", color: "#4ade80", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              POSITIVE SIGNALS
            </div>
            {POSITIVE.map(([pts, label]) => row(pts, label))}
          </div>

          {/* Vertical divider */}
          <div style={{ background: "rgba(255,255,255,0.07)", alignSelf: "stretch" }} />

          {/* Negative + notes */}
          <div>
            <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em", color: "#f87171", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              PENALTIES
            </div>
            {NEGATIVE.map(([pts, label]) => row(pts, label))}

            <div style={{ marginTop: "20px", fontSize: "11px", color: "rgba(255,255,255,0.25)", lineHeight: 1.7 }}>
              <p style={{ marginBottom: "8px" }}>
                Broker signals include: "brokerage", "site visit", "schedule a visit", "multiple options available", "agent", etc.
              </p>
              <p style={{ marginBottom: "8px" }}>
                Spam signals include: "forward this", "join our group", "visit our website", etc.
              </p>
              <p>Score is clamped between 0 and 100. Use the quality filter slider to hide posts below a threshold.</p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
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
  "kalyan nagar","rt nagar","kadubeesanahalli","thubarahalli","kadugodi",
  "bommanahalli","nagawara","hbr layout","cv raman nagar","old airport road",
  "ejipura","ulsoor","basavanagudi","sadashivanagar","vijayanagar","kengeri",
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

  if (post.source === "housing") {
    rows.push({ pts: +15, label: "Housing.com trust bonus (verified listing)" });
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
  const [searchParams]                      = useSearchParams();
  const locationParam                       = searchParams.get("location");

  const [area,           setArea]           = useState(locationParam || "");
  const [bhk,            setBhk]            = useState("any");
  const [budget,         setBudget]         = useState("");
  const [keywords,       setKeywords]       = useState("");
  const [sortBy,         setSortBy]         = useState("score");
  const [minScore,       setMinScore]       = useState(20);
  const [sources,        setSources]        = useState({ reddit: true, telegram: true, nobroker: true, housing: true });
  const [posts,          setPosts]          = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState("");
  const [redditWarning,  setRedditWarning]  = useState(false);
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
  const [showScoreInfo,  setShowScoreInfo]  = useState(false);
  const toastTimer                          = useRef(null);
  const didAutoSearch                       = useRef(false);
  const { theme, toggleTheme }              = useTheme();

  // Reset to page 1 whenever new search results arrive
  useEffect(() => { setPage(1); }, [posts]);

  // Auto-trigger search when arriving from landing page with a location param
  useEffect(() => {
    if (locationParam && !didAutoSearch.current) {
      didAutoSearch.current = true;
      doSearch({ area: locationParam, bhk: "any", budget: "", keywords: "", sort: "score", minScore: 20 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setRedditWarning(false);
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
      setMeta({
        query: data.query, subreddits: data.subreddits, total: data.total,
        localityExpanded: data.locality_expanded || [],
      });
      setRedditWarning(!!data.reddit_warning);
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
    <div className="app-page">
      <BackgroundPattern theme={theme} />

      <div style={{ position: 'relative', zIndex: 1 }}>

      {/* ── Sticky navbar ── */}
      <nav className="app-nav">
        <Link to="/" className="app-nav-logo">
          <svg width="24" height="24" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="14" fill="none" stroke="#f5a623" strokeWidth="2"/>
            <circle cx="16" cy="16" r="8" fill="none" stroke="#f5a623" strokeWidth="1.5" opacity="0.6"/>
            <circle cx="16" cy="16" r="3" fill="#f5a623"/>
            <line x1="16" y1="16" x2="28" y2="6" stroke="#f5a623" strokeWidth="1.5" opacity="0.8"/>
          </svg>
          <span>FlatRadar</span>
        </Link>
        <div className="app-nav-right">
          <span className="app-nav-sub">Bangalore Rental Aggregator</span>
          <button className="app-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4"/>
                <line x1="12" y1="2"  x2="12" y2="5"/>
                <line x1="12" y1="19" x2="12" y2="22"/>
                <line x1="2"  y1="12" x2="5"  y2="12"/>
                <line x1="19" y1="12" x2="22" y2="12"/>
                <line x1="4.22"  y1="4.22"  x2="6.34"  y2="6.34"/>
                <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
                <line x1="19.78" y1="4.22"  x2="17.66" y2="6.34"/>
                <line x1="6.34"  y1="17.66" x2="4.22"  y2="19.78"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
        </div>
      </nav>

      <div className="main-container" style={{ maxWidth: "1380px", margin: "0 auto" }}>

        {/* Saved Searches Panel */}
        {savedSearches.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <button
              onClick={() => setSavedPanelOpen(o => !o)}
              className="saved-searches-btn"
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
        <div className="search-form-container">
          {/* Row 1: Area | Type | Budget | Keywords — 4 columns */}
          <div className="search-fields-grid">
            <div>
              <label className="app-field-label">Area</label>
              <input
                value={area}
                onChange={e => setArea(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Koramangala, Indiranagar, Whitefield..."
                className="app-input"
              />
            </div>
            <div>
              <label className="app-field-label">Type</label>
              <select value={bhk} onChange={e => setBhk(e.target.value)}
                className="app-input app-select">
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
              <label className="app-field-label">Budget</label>
              <input value={budget} onChange={e => setBudget(e.target.value)}
                placeholder="20000, under 30k..."
                className="app-input"
              />
            </div>
            <div>
              <label className="app-field-label">Keywords</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="furnished, parking..."
                className="app-input"
              />
            </div>
          </div>

          {/* Sort + Quality filter row */}
          <div className="sort-quality-grid">
            <div>
              <label className="app-field-label">Sort by</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="app-input app-select"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label className="app-field-label quality-filter-label" style={{ marginBottom: 0 }}>
                  Quality filter —{" "}
                  <span style={{ color: minScore >= 60 ? "#22c55e" : minScore >= 40 ? "#f59e0b" : minScore > 0 ? "#9ca3af" : "rgba(255,255,255,0.3)", fontWeight: 700 }}>
                    {minScore === 0 ? "Off" : minScore >= 60 ? "High" : minScore >= 40 ? "Medium" : "Low"}
                  </span>
                  {minScore > 0 && (
                    <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400, marginLeft: "4px" }}>({minScore}+)</span>
                  )}
                </label>
                <button
                  onClick={() => setShowScoreInfo(true)}
                  style={{
                    background: "rgba(245,166,35,0.1)",
                    border: "1px solid rgba(245,166,35,0.25)",
                    borderRadius: "6px",
                    color: "#f5a623", fontSize: "11px", fontFamily: "inherit",
                    cursor: "pointer", padding: "3px 10px",
                    letterSpacing: "0.02em", transition: "all 0.15s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,166,35,0.2)"; e.currentTarget.style.borderColor = "rgba(245,166,35,0.5)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,166,35,0.1)"; e.currentTarget.style.borderColor = "rgba(245,166,35,0.25)"; }}
                >
                  How scoring works →
                </button>
              </div>
              <input
                type="range" min={0} max={60} step={10}
                value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#f5a623", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-secondary)", fontFamily: "monospace", marginTop: "4px" }}>
                <span>Off</span><span>Low</span><span>Med</span><span>High</span>
              </div>
            </div>
          </div>

          {/* Source toggles */}
          <div style={{ marginBottom: "14px" }}>
            <label className="app-field-label">Sources</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {SOURCE_DEFS.map(s => {
                const active = sources[s.id];
                return (
                  <button
                    key={s.id}
                    onClick={() => setSources(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                    className={`source-toggle-btn${active ? " active" : ""}`}
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
              className="scan-button"
              style={loading ? { background: "var(--bg-secondary)", color: "var(--text-muted)", cursor: "not-allowed", transform: "none", boxShadow: "none" } : undefined}
            >
              {loading ? "⟳  Searching..." : "▶  Scan for listings"}
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              title="Save this search"
              className="save-search-btn"
              style={{
                padding: "13px 18px",
                background: justSaved ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.06)",
                color: justSaved ? "#4ade80" : "#f5a623",
                border: `1px solid ${justSaved ? "rgba(74,222,128,0.4)" : "rgba(245,166,35,0.35)"}`,
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

        {/* Fatal error */}
        {error && (
          <div style={{
            background: "rgba(255,60,60,0.07)", border: "1px solid rgba(255,60,60,0.25)",
            borderRadius: "6px", padding: "12px 16px",
            color: "#ff6b6b", fontSize: "12px", marginBottom: "20px",
          }}>⚠ {error}</div>
        )}

        {/* Soft Reddit warning — amber, non-blocking */}
        {redditWarning && sources.reddit && !error && (
          <div style={{
            background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: "6px", padding: "10px 16px",
            color: "#fbbf24", fontSize: "11px", fontFamily: "monospace",
            marginBottom: "20px",
          }}>
            ⚠ Reddit results unavailable — showing Telegram and NoBroker only
          </div>
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
          <div className="tab-bar" style={{ borderBottom: "1px solid #1a1a24", marginBottom: "20px" }}>
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

            {posts.length > 0 ? (() => {
              const sorted   = sortedPosts(posts, sortBy).filter(p => !hiddenPosts.has(p.id));
              const newCount      = sorted.filter(p => p.created > lastVisit).length;
              const redditCount   = sorted.filter(p => (p.source || "reddit") === "reddit").length;
              const telegramCount = sorted.filter(p => p.source === "telegram").length;
              const nobrokerCount = sorted.filter(p => p.source === "nobroker").length;
              const housingCount  = sorted.filter(p => p.source === "housing").length;
              const multiSource   = (redditCount > 0 ? 1 : 0) + (telegramCount > 0 ? 1 : 0) + (nobrokerCount > 0 ? 1 : 0) + (housingCount > 0 ? 1 : 0) > 1;
              return (
                <>
                  {newCount > 0 && viewMode !== "map" && (
                    <div className="new-listings-banner" style={{
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
                  {meta?.localityExpanded?.length > 1 && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap",
                      background: "rgba(59,130,246,0.06)",
                      border: "1px solid rgba(59,130,246,0.15)",
                      borderRadius: "6px", padding: "8px 14px", marginBottom: "14px",
                      color: "#7eb8f7", fontSize: "10px", fontFamily: "monospace",
                    }}>
                      <span>📍</span>
                      <span>Searching {meta.localityExpanded.length} areas:</span>
                      {meta.localityExpanded.map(loc => (
                        <span key={loc} style={{
                          background: "rgba(59,130,246,0.12)", padding: "2px 8px",
                          borderRadius: "12px", fontSize: "9px",
                        }}>{loc}</span>
                      ))}
                    </div>
                  )}
                  <div className="results-header" style={{ marginBottom: "14px", paddingBottom: "10px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <span className="results-count" style={{ color: "#f5a623", fontSize: "13px" }}>
                        {sorted.length} listing{sorted.length !== 1 ? "s" : ""}
                      </span>
                      {multiSource && (
                        <span style={{ color: "#555", fontSize: "10px", fontFamily: "monospace" }}>
                          —{" "}
                          {redditCount > 0 && <span style={{ color: "#ff4500" }}>🟠 {redditCount} Reddit{"  "}</span>}
                          {telegramCount > 0 && <span style={{ color: "#229ed9" }}>✈️ {telegramCount} Telegram{"  "}</span>}
                          {nobrokerCount > 0 && <span style={{ color: "#e63946" }}>🔴 {nobrokerCount} NoBroker{"  "}</span>}
                          {housingCount > 0 && <span style={{ color: "#7c3aed" }}>🏠 {housingCount} Housing.com</span>}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {/* List / Map toggle */}
                      <div className="view-toggle-group">
                        {[["list", "☰ List"], ["grid", "▦ Grid"], ["map", "🗺 Map"]].map(([id, label]) => (
                          <button
                            key={id}
                            onClick={() => setViewMode(id)}
                            className={`view-toggle-btn${viewMode === id ? " active" : ""}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {viewMode !== "map" && (
                        <span className="best-match-label" style={{ color: "var(--text-muted)", fontSize: "9px", letterSpacing: "0.1em", fontFamily: "monospace" }}>
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
                        <div className="cards-grid">
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
                <div className="cards-grid" style={{ marginBottom: 0 }}>
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

      {showScoreInfo && (
        <ScoreInfoModal onClose={() => setShowScoreInfo(false)} />
      )}

      </div>{/* end relative content wrapper */}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }

        /* ── CSS custom properties ───────────────────────────────────── */
        :root, [data-theme="dark"] {
          --bg-primary:    #0d0d14;
          --bg-secondary:  #13131f;
          --border:        rgba(255,255,255,0.08);
          --border-accent: rgba(245,166,35,0.2);
          --input-bg:      rgba(255,255,255,0.05);
          --input-border:  #2a2a3a;
          --input-text:    #e8e4d8;
          --text-primary:  #e8e4d8;
          --text-secondary:#888;
          --text-muted:    #444;
          --bg-card:       #13131f;
          --pill-bg:       rgba(255,255,255,0.06);
          --select-bg:     #0d0d14;
        }
        [data-theme="light"] {
          --bg-primary:    #f6f8fa;
          --bg-secondary:  #ffffff;
          --border:        #e5e7eb;
          --border-accent: rgba(245,166,35,0.3);
          --input-bg:      #ffffff;
          --input-border:  #d1d5db;
          --input-text:    #111827;
          --text-primary:  #111827;
          --text-secondary:#374151;
          --text-muted:    #6b7280;
          --bg-card:       #ffffff;
          --pill-bg:       rgba(0,0,0,0.05);
          --select-bg:     #ffffff;
        }

        /* ── Global ──────────────────────────────────────────────────── */
        html, body { overflow-x: hidden; }
        body { transition: background 0.25s ease, color 0.25s ease; }

        select option { background: var(--select-bg); color: var(--input-text); }

        /* ── Page background ─────────────────────────────────────────── */
        .app-page {
          min-height: 100vh;
          background-color: var(--bg-primary);
          color: var(--text-primary);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          position: relative;
        }

        [data-theme="dark"] .app-page {
          background-color: #0d0d14;
          min-height: 100vh;
        }

        /* ── Sticky navbar ───────────────────────────────────────────── */
        .app-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 32px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-primary);
          position: sticky;
          top: 0;
          z-index: 100;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .app-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 20px;
          font-weight: 700;
          color: #f5a623;
          text-decoration: none;
          letter-spacing: 0.3px;
        }
        .app-nav-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .app-nav-sub {
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.3px;
        }
        .app-theme-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 50%;
          color: var(--text-muted);
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s, background 0.2s;
        }
        .app-theme-btn:hover {
          border-color: #f5a623;
          color: #f5a623;
        }
        @media (max-width: 600px) {
          .app-nav { padding: 12px 16px; }
          .app-nav-sub { display: none; }
        }

        /* ── Main content container ──────────────────────────────────── */
        .main-container { padding: 28px 32px 40px; }
        @media (max-width: 768px) { .main-container { padding: 16px; } }

        /* ── Field labels ────────────────────────────────────────────── */
        .app-field-label {
          display: block;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 7px;
        }

        /* ── Input / select fields ───────────────────────────────────── */
        .app-input {
          width: 100%;
          padding: 12px 14px;
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          color: var(--input-text);
          font-size: 13px;
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .app-input:focus {
          border-color: rgba(245,166,35,0.5);
          box-shadow: 0 0 0 3px rgba(245,166,35,0.08), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .app-input::placeholder { color: rgba(255,255,255,0.3); }
        .app-select { background: rgba(20,20,30,0.8); cursor: pointer; }
        [data-theme="light"] .app-input {
          background: rgba(255,255,255,0.75);
          border-color: rgba(0,0,0,0.1);
        }
        [data-theme="light"] .app-input:focus {
          border-color: rgba(245,166,35,0.5);
          box-shadow: 0 0 0 3px rgba(245,166,35,0.1);
        }
        [data-theme="light"] .app-input::placeholder { color: rgba(0,0,0,0.35); }
        [data-theme="light"] .app-select { background: rgba(255,255,255,0.85); }

        /* ── Search form container ───────────────────────────────────── */
        .search-form-container {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          box-shadow:
            0 8px 32px rgba(0,0,0,0.3),
            inset 0 1px 0 rgba(255,255,255,0.08);
          padding: 24px;
          margin-bottom: 28px;
          position: relative;
          overflow: hidden;
        }
        .search-form-container::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(245,166,35,0.8), transparent);
        }
        @media (max-width: 768px) {
          .search-form-container { padding: 16px; border-radius: 14px; }
        }

        /* ── Scan button ─────────────────────────────────────────────── */
        .scan-button {
          flex: 1;
          padding: 15px;
          background: linear-gradient(135deg, #f5a623 0%, #e09400 100%);
          color: #000000;
          border: none;
          border-radius: 12px;
          font-size: 13px;
          font-family: inherit;
          font-weight: 700;
          letter-spacing: 0.6px;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(245,166,35,0.3), inset 0 1px 0 rgba(255,255,255,0.2);
          transition: box-shadow 0.2s, transform 0.1s;
        }
        .scan-button:hover:not(:disabled) {
          box-shadow: 0 6px 24px rgba(245,166,35,0.45), inset 0 1px 0 rgba(255,255,255,0.2);
          transform: translateY(-1px);
        }
        .scan-button:active:not(:disabled) { transform: translateY(0); }

        /* ── Search fields: 4-col → 2-col → 1-col ───────────────────── */
        .search-fields-grid {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 12px;
          margin-bottom: 14px;
        }
        @media (max-width: 768px) { .search-fields-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 480px) { .search-fields-grid { grid-template-columns: 1fr; } }

        /* ── Sort + quality row: 2-col → 1-col ──────────────────────── */
        .sort-quality-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 14px;
        }
        @media (max-width: 768px) { .sort-quality-grid { grid-template-columns: 1fr; } }

        /* ── Tab bar ─────────────────────────────────────────────────── */
        .tab-bar { display: flex; }
        @media (max-width: 768px) {
          .tab-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; }
          .tab-bar button { white-space: nowrap; flex-shrink: 0; }
        }

        /* ── Results header row ──────────────────────────────────────── */
        .results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border);
        }
        @media (max-width: 768px) { .results-count { font-size: 11px !important; } }

        /* ── Hide "BEST MATCH" sort label on mobile ──────────────────── */
        @media (max-width: 768px) { .best-match-label { display: none !important; } }

        /* ── New listings banner ─────────────────────────────────────── */
        .new-listings-banner { flex-wrap: wrap; }
        @media (max-width: 768px) { .new-listings-banner { font-size: 13px !important; padding: 10px 14px !important; } }

        /* ── Cards grid: 4-col → 3-col → 2-col ──────────────────────── */
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 8px;
        }
        @media (max-width: 768px) { .cards-grid { grid-template-columns: repeat(3, 1fr); gap: 12px; } }
        @media (max-width: 480px) { .cards-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; } }

        /* ── Post tile (grid view) ────────────────────────────────────── */
        .post-tile { overflow: hidden; word-break: break-word; box-sizing: border-box; }
        .post-tile::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.15), transparent);
          z-index: 1;
          pointer-events: none;
        }
        @media (max-width: 768px) {
          .post-tile { padding: 12px !important; min-height: unset !important; }
          .post-tile img { max-height: 140px !important; }
        }

        /* ── Post card (list view) ───────────────────────────────────── */
        .post-card { overflow: hidden; word-break: break-word; box-sizing: border-box; }
        @media (max-width: 768px) { .post-card { padding: 12px !important; } }

        /* ── Map container ───────────────────────────────────────────── */
        .map-container {
          height: 520px;
          border-radius: 8px;
          border: 1px solid var(--border);
          overflow: hidden;
        }
        @media (max-width: 768px) { .map-container { height: 60vh; min-height: 300px; } }

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

        /* ═══════════════════════════════════════════════════════════════
           LIGHT MODE OVERRIDES
           ═══════════════════════════════════════════════════════════════ */

        [data-theme="light"] .app-page {
          background-color: #f3f4f6;
          min-height: 100vh;
        }

        /* Navbar */
        [data-theme="light"] .app-nav {
          background: rgba(255,255,255,0.92);
          border-bottom: 1px solid #e5e7eb;
        }
        [data-theme="light"] .app-nav-sub {
          color: #9ca3af;
        }

        /* Search form — light glass */
        [data-theme="light"] .search-form-container {
          background: rgba(255,255,255,0.7);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.9);
          box-shadow:
            0 8px 32px rgba(0,0,0,0.08),
            inset 0 1px 0 rgba(255,255,255,0.9);
        }

        /* Input fields — light glass */
        [data-theme="light"] .app-input {
          background: rgba(255,255,255,0.8) !important;
          border: 1px solid rgba(0,0,0,0.08) !important;
          color: #111827 !important;
        }
        [data-theme="light"] .app-input:focus {
          border-color: rgba(245,166,35,0.5) !important;
          box-shadow: 0 0 0 3px rgba(245,166,35,0.1) !important;
        }
        [data-theme="light"] .app-input::placeholder {
          color: rgba(0,0,0,0.35) !important;
        }

        /* Field labels */
        [data-theme="light"] .app-field-label {
          color: #6b7280;
        }

        /* Listing cards — light glass */
        [data-theme="light"] .post-tile,
        [data-theme="light"] .post-card {
          background: rgba(255,255,255,0.75) !important;
          /* Use inset shadow for left/right/bottom borders so borderTop accent stays untouched */
          box-shadow:
            inset  1px 0 0 rgba(0,0,0,0.09),
            inset -1px 0 0 rgba(0,0,0,0.09),
            inset  0 -1px 0 rgba(0,0,0,0.09),
            0 2px 8px rgba(0,0,0,0.06);
        }
        [data-theme="light"] .post-tile:hover,
        [data-theme="light"] .post-card:hover {
          background: rgba(255,255,255,0.92) !important;
          box-shadow:
            inset  1px 0 0 rgba(245,166,35,0.2),
            inset -1px 0 0 rgba(245,166,35,0.2),
            inset  0 -1px 0 rgba(245,166,35,0.2),
            0 8px 24px rgba(0,0,0,0.1) !important;
        }

        /* Source toggle buttons — glass style in light mode */
        [data-theme="light"] .source-toggle-btn {
          background: rgba(255,255,255,0.7) !important;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        /* Inactive buttons get a neutral colour; active keeps its brand colour inline */
        [data-theme="light"] .source-toggle-btn:not(.active) {
          border: 1px solid rgba(0,0,0,0.08) !important;
          color: #374151 !important;
        }
        [data-theme="light"] .source-toggle-btn.active {
          background: rgba(255,255,255,0.9) !important;
        }
        [data-theme="light"] .source-toggle-btn:hover {
          background: rgba(255,255,255,0.92) !important;
        }

        /* Quality filter slider */
        input[type="range"]::-webkit-slider-runnable-track {
          height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.12);
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #f5a623;
          border: 2px solid rgba(255,255,255,0.3);
          margin-top: -6px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        [data-theme="light"] input[type="range"] {
          accent-color: #f5a623;
        }
        [data-theme="light"] input[type="range"]::-webkit-slider-runnable-track {
          background: #e2e8f0;
        }
        [data-theme="light"] input[type="range"]::-webkit-slider-thumb {
          background: #f5a623;
          border: 2px solid #ffffff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }

        /* Saved searches toggle button */
        [data-theme="light"] .saved-searches-btn {
          background: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          color: #374151 !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        /* ★ Save-search button */
        [data-theme="light"] .save-search-btn {
          background: rgba(245,166,35,0.06) !important;
          border-color: rgba(245,166,35,0.35) !important;
        }

        /* Scan button — light loading state */
        [data-theme="light"] .scan-button:disabled {
          background: #e5e7eb !important;
          color: #9ca3af !important;
          box-shadow: none !important;
        }

        /* Select option background in light mode */
        [data-theme="light"] select option {
          background: #ffffff;
          color: #111827;
        }

        /* ── View toggle (List / Grid / Map) ────────────────────────── */
        .view-toggle-group {
          display: flex;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 3px;
          gap: 2px;
        }
        .view-toggle-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 10px;
          font-family: monospace;
          padding: 4px 11px;
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .view-toggle-btn.active {
          background: rgba(245,166,35,0.15);
          color: #f5a623;
        }
        .view-toggle-btn:hover:not(.active) {
          background: rgba(255,255,255,0.07);
          color: var(--text-primary);
        }
        [data-theme="light"] .view-toggle-group {
          background: rgba(0,0,0,0.04);
          border-color: rgba(0,0,0,0.1);
        }
        [data-theme="light"] .view-toggle-btn { color: #374151; }
        [data-theme="light"] .view-toggle-btn.active {
          background: rgba(245,166,35,0.15);
          color: #b45309;
        }
        [data-theme="light"] .view-toggle-btn:hover:not(.active) {
          background: rgba(0,0,0,0.06);
          color: #111827;
        }

        /* ── Post card/tile typography ───────────────────────────────── */
        [data-theme="light"] .post-title     { color: #111827 !important; }
        [data-theme="light"] .post-subtitle  { color: #6b7280 !important; }
        [data-theme="light"] .post-time      { color: #9ca3af !important; }
        [data-theme="light"] .post-meta-text { color: #6b7280 !important; }
        [data-theme="light"] .post-stats     { color: #6b7280 !important; }

        /* Amenity tags */
        [data-theme="light"] .amenity-tag {
          background: rgba(0,0,0,0.05) !important;
          color: #6b7280 !important;
          border-color: rgba(0,0,0,0.1) !important;
        }

        /* ── Card hover overlay ──────────────────────────────────────── */
        [data-theme="light"] .card-hover-overlay {
          background: rgba(248,249,252,0.97) !important;
        }
        [data-theme="light"] .card-hover-overlay button {
          background: rgba(0,0,0,0.05) !important;
          border-color: rgba(0,0,0,0.12) !important;
          color: #374151 !important;
        }
        [data-theme="light"] .overlay-score-label { color: #9ca3af !important; }
        [data-theme="light"] .overlay-divider { border-top-color: #e5e7eb !important; }

        /* ── Pagination ──────────────────────────────────────────────── */
        [data-theme="light"] .pagination-btn {
          background: rgba(0,0,0,0.04);
          border-color: #e5e7eb;
          color: #374151;
        }

        /* ── Quality filter label ────────────────────────────────────── */
        [data-theme="light"] .quality-filter-label { color: #374151 !important; }

        /* ── Results header ──────────────────────────────────────────── */
        [data-theme="light"] .results-header { border-bottom-color: #e5e7eb; }

        /* ── Tab bar ─────────────────────────────────────────────────── */
        [data-theme="light"] .tab-bar button { color: #6b7280; border-color: #e5e7eb; }
        [data-theme="light"] .tab-bar button[style*="color: #f5a623"] { color: #d97706 !important; }
      `}</style>
    </div>
  );
}
