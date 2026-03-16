import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "./ThemeContext";
import cityscapeDark from "./assets/cityscape.png";
import cityscapeLight from "./assets/cityscape_day.jpg";

export default function LandingPage() {
  const [location, setLocation] = useState("");
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const heroImage = theme === "light" ? cityscapeLight : cityscapeDark;

  const handleSearch = () => {
    navigate(`/app${location ? `?location=${encodeURIComponent(location)}` : ""}`);
  };

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="lp-hero"
        style={{
          backgroundImage: `url(${heroImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center 15%",
          backgroundRepeat: "no-repeat",
          transition: "background-image 0.3s ease",
        }}
      >
        {/* Top fade — bleeds page background colour in from the top */}
        <div className="lp-hero-top-fade" />

        {/* Theme toggle */}
        <button className="lp-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>

        <div className="lp-hero-content">
          <div className="lp-logo">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="14" fill="none" stroke="#f5a623" strokeWidth="2"/>
              <circle cx="16" cy="16" r="8" fill="none" stroke="#f5a623" strokeWidth="1.5" opacity="0.6"/>
              <circle cx="16" cy="16" r="3" fill="#f5a623"/>
              <line x1="16" y1="16" x2="28" y2="6" stroke="#f5a623" strokeWidth="1.5" opacity="0.8"/>
            </svg>
            <span>FlatRadar</span>
          </div>

          <h1 className="lp-hero-headline">
            Find your next flat in Bangalore.<br/>
            <span>No brokers. No noise.</span>
          </h1>

          <p className="lp-hero-sub">
            Scans <span style={{ color: "#ff4500" }}>Reddit</span>,{" "}
            <span style={{ color: "#229ed9" }}>Telegram</span>,{" "}
            <span style={{ color: "#e63946" }}>NoBroker</span> and more — scored, filtered,
            and ranked in real time.
          </p>

          <div className="lp-hero-search">
            <input
              type="text"
              placeholder="Whitefield, HSR Layout, Koramangala..."
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
            />
            <button onClick={handleSearch}>
              Scan Listings →
            </button>
          </div>
        </div>
      </section>

      {/* ── Sources strip ────────────────────────────────────────────────── */}
      <section className="lp-sources-strip">
        <p className="lp-sources-label">Scanning listings from</p>
        <div className="lp-sources-list">
          <div className="lp-source-item lp-reddit-source">
            <span className="lp-source-dot"/>
            Reddit
          </div>
          <div className="lp-source-divider"/>
          <div className="lp-source-item lp-telegram-source">
            <span className="lp-source-dot"/>
            Telegram
          </div>
          <div className="lp-source-divider"/>
          <div className="lp-source-item lp-nobroker-source">
            <span className="lp-source-dot"/>
            NoBroker
          </div>
          <div className="lp-source-divider"/>
          <div className="lp-source-item lp-housing-source">
            <span className="lp-source-dot"/>
            Housing.com
            <span className="lp-coming-soon">soon</span>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="lp-how-it-works">
        <h2>How FlatRadar works</h2>
        <div className="lp-steps">
          <div className="lp-step">
            <div className="lp-step-number">01</div>
            <h3>Search your area</h3>
            <p>Enter a locality — Whitefield, HSR, Koramangala, anywhere in Bangalore.</p>
          </div>
          <div className="lp-step-arrow">→</div>
          <div className="lp-step">
            <div className="lp-step-number">02</div>
            <h3>We scan everything</h3>
            <p>FlatRadar pulls listings from Reddit, Telegram groups, NoBroker and more — simultaneously.</p>
          </div>
          <div className="lp-step-arrow">→</div>
          <div className="lp-step">
            <div className="lp-step-number">03</div>
            <h3>Ranked by quality</h3>
            <p>Every listing is scored. Owner-direct, detailed posts with contact info rise to the top.</p>
          </div>
        </div>
      </section>

      {/* ── CTA footer ───────────────────────────────────────────────────── */}
      <section className="lp-cta-section">
        <h2>Start finding your flat</h2>
        <p>Free, no sign-up required. Just search.</p>
        <button onClick={() => navigate("/app")}>
          Open FlatRadar →
        </button>
      </section>

      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          background: #0d0d14;
          color: #ffffff;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          overflow-x: hidden;
          transition: background 0.25s ease, color 0.25s ease;
        }

        [data-theme="light"] body {
          background: #f6f8fa;
          color: #111827;
        }

        /* ── Hero ── */
        .lp-hero {
          position: relative;
          width: 100%;
          height: 100vh;
          min-height: 600px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 0 24px;
        }

        .lp-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 0;
        }

        .lp-hero::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 55%;
          background: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(13,13,20,0.6) 50%,
            #0d0d14 100%
          );
          z-index: 1;
        }

        .lp-hero-top-fade {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 15%;
          background: linear-gradient(to bottom, #0d0d14, transparent);
          z-index: 1;
          pointer-events: none;
        }

        .lp-hero-content {
          position: relative;
          z-index: 2;
          max-width: 720px;
        }

        .lp-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          justify-content: center;
          margin-bottom: 32px;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: #f5a623;
        }

        .lp-hero-headline {
          font-size: clamp(32px, 5vw, 56px);
          font-weight: 800;
          line-height: 1.15;
          color: #ffffff;
          margin-bottom: 20px;
          letter-spacing: -0.5px;
          text-shadow: 0 2px 20px rgba(0,0,0,0.5);
        }

        .lp-hero-headline span {
          color: #f5a623;
        }

        .lp-hero-sub {
          font-size: 17px;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.7);
          letter-spacing: 0.3px;
          line-height: 1.7;
          max-width: 480px;
          margin: 0 auto 48px;
          text-shadow: 0 1px 12px rgba(0,0,0,0.8);
        }

        .lp-hero-search {
          display: flex;
          width: 100%;
          max-width: 520px;
          margin: 0 auto;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .lp-hero-search input {
          flex: 1;
          padding: 16px 20px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          outline: none;
          font-size: 15px;
          font-weight: 400;
          color: #ffffff;
          letter-spacing: 0.2px;
        }

        .lp-hero-search input::placeholder {
          color: rgba(255, 255, 255, 0.45);
          font-weight: 300;
        }

        .lp-hero-search button {
          padding: 16px 28px;
          background: #f5a623;
          border: none;
          color: #000000;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 0.3px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s;
          flex-shrink: 0;
        }

        .lp-hero-search button:hover {
          background: #e09400;
        }

        /* ── Sources strip ── */
        .lp-sources-strip {
          background: #111120;
          border-top: 1px solid rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding: 24px;
          text-align: center;
        }

        .lp-sources-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: rgba(255,255,255,0.4);
          margin-bottom: 16px;
        }

        .lp-sources-list {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          flex-wrap: wrap;
        }

        .lp-source-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 500;
        }

        .lp-reddit-source   { color: #ff4500; }
        .lp-telegram-source { color: #229ed9; }
        .lp-nobroker-source { color: #e63946; }
        .lp-housing-source  { color: #7c3aed; }

        .lp-source-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          flex-shrink: 0;
          display: inline-block;
        }

        .lp-source-divider {
          width: 1px;
          height: 16px;
          background: rgba(255,255,255,0.15);
        }

        .lp-coming-soon {
          font-size: 10px;
          background: rgba(124,58,237,0.15);
          padding: 2px 6px;
          border-radius: 4px;
          color: #7c3aed;
        }

        /* ── How it works ── */
        .lp-how-it-works {
          padding: 80px 24px;
          max-width: 960px;
          margin: 0 auto;
          text-align: center;
        }

        .lp-how-it-works h2 {
          font-size: clamp(24px, 3vw, 36px);
          font-weight: 700;
          margin-bottom: 56px;
          color: #fff;
        }

        .lp-steps {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .lp-step {
          flex: 1;
          min-width: 200px;
          max-width: 260px;
          text-align: center;
        }

        .lp-step-number {
          font-size: 48px;
          font-weight: 800;
          color: rgba(245,166,35,0.15);
          line-height: 1;
          margin-bottom: 16px;
        }

        .lp-step h3 {
          font-size: 17px;
          font-weight: 600;
          margin-bottom: 10px;
          color: #fff;
        }

        .lp-step p {
          font-size: 14px;
          color: rgba(255,255,255,0.55);
          line-height: 1.6;
        }

        .lp-step-arrow {
          font-size: 24px;
          color: rgba(255,255,255,0.2);
          padding-top: 24px;
          flex-shrink: 0;
        }

        /* ── CTA section ── */
        .lp-cta-section {
          background: #111120;
          padding: 80px 24px;
          text-align: center;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        .lp-cta-section h2 {
          font-size: clamp(24px, 3vw, 40px);
          font-weight: 800;
          margin-bottom: 12px;
          color: #fff;
        }

        .lp-cta-section p {
          color: rgba(255,255,255,0.5);
          margin-bottom: 32px;
          font-size: 16px;
        }

        .lp-cta-section button {
          padding: 16px 40px;
          background: #f5a623;
          color: #000;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
        }

        .lp-cta-section button:hover {
          background: #e09400;
          transform: translateY(-1px);
        }

        /* ── Theme toggle button ── */
        .lp-theme-toggle {
          position: absolute;
          top: 20px;
          right: 24px;
          z-index: 3;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          padding: 7px 11px;
          font-size: 16px;
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: background 0.2s, border-color 0.2s;
          line-height: 1;
        }
        .lp-theme-toggle:hover {
          background: rgba(0, 0, 0, 0.5);
          border-color: rgba(255, 255, 255, 0.3);
        }
        [data-theme="light"] .lp-theme-toggle {
          background: rgba(255, 255, 255, 0.5);
          border-color: rgba(0, 0, 0, 0.12);
        }
        [data-theme="light"] .lp-theme-toggle:hover {
          background: rgba(255, 255, 255, 0.75);
        }

        /* ── Light mode: hero overlays ── */
        [data-theme="light"] .lp-hero::before {
          background: rgba(255, 255, 255, 0.15);
        }
        [data-theme="light"] .lp-hero::after {
          background: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(246, 248, 250, 0.7) 60%,
            #f6f8fa 100%
          );
        }
        [data-theme="light"] .lp-hero-top-fade {
          background: linear-gradient(to bottom, #f6f8fa, transparent);
        }

        /* ── Light mode: hero text ── */
        [data-theme="light"] .lp-hero-headline {
          color: #1a1a2e;
          text-shadow: 0 1px 12px rgba(255, 255, 255, 0.6);
        }
        [data-theme="light"] .lp-hero-headline span {
          color: #c47f00;
        }
        [data-theme="light"] .lp-hero-sub {
          color: rgba(0, 0, 0, 0.65);
          text-shadow: 0 1px 8px rgba(255, 255, 255, 0.8);
        }
        [data-theme="light"] .lp-logo {
          color: #c47f00;
        }

        /* ── Light mode: search bar ── */
        [data-theme="light"] .lp-hero-search {
          border: 1px solid rgba(0, 0, 0, 0.12);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        }
        [data-theme="light"] .lp-hero-search input {
          background: rgba(255, 255, 255, 0.85);
          color: #111827;
        }
        [data-theme="light"] .lp-hero-search input::placeholder {
          color: rgba(0, 0, 0, 0.4);
        }

        /* ── Light mode: sections below hero ── */
        [data-theme="light"] .lp-sources-strip {
          background: #eef0f4;
          border-color: rgba(0, 0, 0, 0.06);
        }
        [data-theme="light"] .lp-sources-label {
          color: rgba(0, 0, 0, 0.4);
        }
        [data-theme="light"] .lp-source-divider {
          background: rgba(0, 0, 0, 0.12);
        }
        [data-theme="light"] .lp-how-it-works h2,
        [data-theme="light"] .lp-step h3 {
          color: #111827;
        }
        [data-theme="light"] .lp-step p {
          color: rgba(0, 0, 0, 0.55);
        }
        [data-theme="light"] .lp-step-number {
          color: rgba(180, 100, 0, 0.15);
        }
        [data-theme="light"] .lp-step-arrow {
          color: rgba(0, 0, 0, 0.2);
        }
        [data-theme="light"] .lp-cta-section {
          background: #eef0f4;
          border-color: rgba(0, 0, 0, 0.06);
        }
        [data-theme="light"] .lp-cta-section h2 {
          color: #111827;
        }
        [data-theme="light"] .lp-cta-section p {
          color: rgba(0, 0, 0, 0.5);
        }

        /* ── Mobile responsive ── */
        @media (max-width: 600px) {
          .lp-hero-search {
            flex-direction: column;
            border-radius: 12px;
          }
          .lp-hero-search input,
          .lp-hero-search button {
            width: 100%;
            border-radius: 0;
          }
          .lp-step-arrow { display: none; }
          .lp-steps { gap: 32px; }
        }
      `}</style>
    </div>
  );
}
