import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "./ThemeContext";
import cityscapeDark from "./assets/cityscape.png";
import cityscapeLight from "./assets/cityscape_day.jpg";
import Navbar from "./components/Navbar";

export default function LandingPage() {
  const [location, setLocation] = useState("");
  const navigate = useNavigate();
  const { theme } = useTheme();
  const heroImage = theme === "light" ? cityscapeLight : cityscapeDark;

  const handleSearch = () => {
    navigate(`/app${location ? `?location=${encodeURIComponent(location)}` : ""}`);
  };

  return (
    <div>
      <Navbar showAppCta />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="lp-hero"
        style={{
          backgroundImage: `url(${heroImage})`,
          backgroundSize: "cover",
          backgroundPosition: theme === "light" ? "center 35%" : "center 20%",
          backgroundRepeat: "no-repeat",
          transition: "background-image 0.3s ease",
        }}
      >
        {/* Top fade — bleeds page background colour in from the top */}
        <div className="lp-hero-top-fade" />

        <div className="lp-hero-content">
          <div className="lp-logo">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="14" fill="none" stroke="#f5a623" strokeWidth="2" className="lp-radar-ping"/>
              <circle cx="16" cy="16" r="8" fill="none" stroke="#f5a623" strokeWidth="1.5" opacity="0.6"/>
              <circle cx="16" cy="16" r="3" fill="#f5a623"/>
              <line x1="16" y1="16" x2="28" y2="6" stroke="#f5a623" strokeWidth="1.5" className="lp-radar-arm"/>
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

        {/* Scroll hint — mouse icon with sliding dot */}
        <div className="lp-scroll-hint" aria-hidden="true">
          <svg width="26" height="40" viewBox="0 0 26 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Mouse body */}
            <rect x="1" y="1" width="24" height="38" rx="12" stroke="currentColor" strokeWidth="1.8"/>
            {/* Scroll wheel dot */}
            <rect className="lp-scroll-dot" x="11" y="8" width="4" height="7" rx="2" fill="currentColor"/>
          </svg>
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
          </div>
          <div className="lp-source-divider"/>
          <div className="lp-source-item lp-99acres-source">
            <span className="lp-source-dot"/>
            99acres
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

      {/* ── Scoring section ──────────────────────────────────────────────── */}
      <section className="lp-scoring">
        <div className="lp-scoring-inner">
          <div className="lp-scoring-header">
            <h2>How listings are scored</h2>
            <p>
              Every listing gets a quality score from 0–100. We reward posts
              that give renters what they actually need — and penalise broker
              noise and spam.
            </p>
          </div>

          <div className="lp-scoring-grid">
            {/* Positive signals */}
            <div className="lp-signal-group">
              <div className="lp-signal-group-label lp-signal-positive">Positive signals</div>
              {[
                ["+20", "Has a price listed"],
                ["+20", "Has a contact number"],
                ["+20", "Posted today"],
                ["+15", "Bangalore locality detected"],
                ["+15", "BHK type mentioned"],
                ["+15", "NoBroker trust bonus"],
                ["+10", "Posted this week"],
                ["+10", "Detailed Telegram message"],
                ["+10", "Reddit upvotes > 10"],
                [" +5", "Furnished status mentioned"],
                [" +5", "Deposit info mentioned"],
                [" +5", "Reddit comments > 5"],
              ].map(([pts, label]) => (
                <div key={label} className="lp-signal-row">
                  <span className="lp-signal-pts lp-pts-positive">{pts}</span>
                  <span className="lp-signal-label">{label}</span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="lp-signal-divider" />

            {/* Penalties + note */}
            <div className="lp-signal-group">
              <div className="lp-signal-group-label lp-signal-negative">Penalties</div>
              {[
                ["−10", "One broker signal detected"],
                ["−15", "Spam signal detected"],
                ["−20", "Two or more broker signals"],
              ].map(([pts, label]) => (
                <div key={label} className="lp-signal-row">
                  <span className="lp-signal-pts lp-pts-negative">{pts}</span>
                  <span className="lp-signal-label">{label}</span>
                </div>
              ))}

              <div className="lp-scoring-note">
                <p>
                  Broker signals include phrases like "brokerage", "site visit",
                  "multiple options available", "agent", etc.
                </p>
                <p>
                  Scores are clamped between 0 and 100. Inside the app you can
                  set a minimum score to filter out low-quality posts.
                </p>
              </div>

              <div className="lp-score-examples">
                <div className="lp-score-example lp-score-high">
                  <span className="lp-score-badge">85</span>
                  <span>Owner post · has price, contact, BHK, locality · posted today</span>
                </div>
                <div className="lp-score-example lp-score-mid">
                  <span className="lp-score-badge">45</span>
                  <span>Has locality and BHK · no contact · posted this week</span>
                </div>
                <div className="lp-score-example lp-score-low">
                  <span className="lp-score-badge">10</span>
                  <span>Broker post · multiple spam signals · no contact</span>
                </div>
              </div>
            </div>
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

        @keyframes lp-radar-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        @keyframes lp-radar-ping {
          0%, 100% { opacity: 0.9; }
          50%      { opacity: 0.2; }
        }

        .lp-radar-arm {
          transform-origin: 16px 16px;
          animation: lp-radar-sweep 2s linear infinite;
        }

        .lp-radar-ping {
          animation: lp-radar-ping 2s linear infinite;
        }

        /* ── Scroll hint ── */
        @keyframes lp-scroll-dot-slide {
          0%   { transform: translateY(0);    opacity: 1; }
          60%  { transform: translateY(10px); opacity: 0; }
          61%  { transform: translateY(0);    opacity: 0; }
          100% { transform: translateY(0);    opacity: 1; }
        }

        .lp-scroll-hint {
          position: absolute;
          bottom: 36px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 3;
          color: rgba(255, 255, 255, 0.45);
          pointer-events: none;
          user-select: none;
        }

        .lp-scroll-dot {
          transform-origin: center top;
          animation: lp-scroll-dot-slide 1.8s ease-in-out infinite;
        }

        [data-theme="light"] .lp-scroll-hint {
          color: rgba(0, 0, 0, 0.3);
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
        .lp-99acres-source  { color: #f59e0b; }

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
          color: rgba(245,166,35,0.28);
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


        /* ── Light mode: hero overlays ── */
        [data-theme="light"] .lp-hero::before {
          background: radial-gradient(
            ellipse 70% 60% at 50% 40%,
            rgba(255, 255, 255, 0.45) 0%,
            transparent 100%
          );
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
          text-shadow:
            0 0 40px rgba(255, 255, 255, 0.9),
            0 0 80px rgba(255, 255, 255, 0.7),
            0 2px 4px rgba(255, 255, 255, 0.8);
        }
        [data-theme="light"] .lp-hero-headline span {
          color: #b36d00;
          text-shadow:
            0 0 30px rgba(255, 255, 255, 0.9),
            0 0 60px rgba(255, 255, 255, 0.6);
        }
        [data-theme="light"] .lp-hero-sub {
          color: #1a1a2e;
          font-weight: 500;
          text-shadow: none;
        }
        [data-theme="light"] .lp-logo {
          color: #b36d00;
          text-shadow: 0 0 20px rgba(255, 255, 255, 0.8);
        }
        [data-theme="light"] .lp-logo span {
          color: #b36d00;
          text-shadow: 0 0 20px rgba(255, 255, 255, 0.8);
        }

        /* ── Light mode: search bar ── */
        [data-theme="light"] .lp-hero-search {
          border: 1px solid rgba(0, 0, 0, 0.1);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }
        [data-theme="light"] .lp-hero-search input {
          background: rgba(255, 255, 255, 0.92);
          color: #111827;
        }
        [data-theme="light"] .lp-hero-search input::placeholder {
          color: #9ca3af;
        }
        [data-theme="light"] .lp-hero-search button {
          background: #f5a623;
          color: #000000;
          font-weight: 700;
        }
        [data-theme="light"] .lp-hero-search button:hover {
          background: #e09400;
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
          color: rgba(180, 100, 0, 0.28);
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

        /* ── Scoring section ── */
        .lp-scoring {
          padding: 80px 24px;
          background: #0d0d14;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        .lp-scoring-inner {
          max-width: 860px;
          margin: 0 auto;
        }

        .lp-scoring-header {
          text-align: center;
          margin-bottom: 52px;
        }

        .lp-scoring-header h2 {
          font-size: clamp(24px, 3vw, 36px);
          font-weight: 700;
          color: #fff;
          margin-bottom: 14px;
        }

        .lp-scoring-header p {
          font-size: 15px;
          color: rgba(255,255,255,0.5);
          line-height: 1.7;
          max-width: 520px;
          margin: 0 auto;
        }

        .lp-scoring-grid {
          display: grid;
          grid-template-columns: 1fr 1px 1fr;
          gap: 0 40px;
          align-items: start;
        }

        .lp-signal-group {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .lp-signal-group-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          margin-bottom: 16px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }

        .lp-signal-positive { color: #4ade80; }
        .lp-signal-negative { color: #f87171; }

        .lp-signal-row {
          display: flex;
          align-items: baseline;
          gap: 12px;
          padding: 7px 0;
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }

        .lp-signal-pts {
          font-size: 12px;
          font-family: monospace;
          font-weight: 700;
          flex-shrink: 0;
          width: 32px;
          text-align: right;
        }

        .lp-pts-positive { color: #4ade80; }
        .lp-pts-negative { color: #f87171; }

        .lp-signal-label {
          font-size: 13px;
          color: rgba(255,255,255,0.65);
          line-height: 1.4;
        }

        .lp-signal-divider {
          background: rgba(255,255,255,0.07);
          align-self: stretch;
        }

        .lp-scoring-note {
          margin-top: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .lp-scoring-note p {
          font-size: 12px;
          color: rgba(255,255,255,0.3);
          line-height: 1.6;
        }

        .lp-score-examples {
          margin-top: 28px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .lp-score-example {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.4;
        }

        .lp-score-high {
          background: rgba(74,222,128,0.07);
          border: 1px solid rgba(74,222,128,0.15);
          color: rgba(255,255,255,0.6);
        }

        .lp-score-mid {
          background: rgba(250,204,21,0.07);
          border: 1px solid rgba(250,204,21,0.15);
          color: rgba(255,255,255,0.6);
        }

        .lp-score-low {
          background: rgba(248,113,113,0.07);
          border: 1px solid rgba(248,113,113,0.15);
          color: rgba(255,255,255,0.6);
        }

        .lp-score-badge {
          font-size: 13px;
          font-family: monospace;
          font-weight: 800;
          flex-shrink: 0;
          width: 32px;
          text-align: center;
        }

        .lp-score-high .lp-score-badge { color: #4ade80; }
        .lp-score-mid .lp-score-badge  { color: #facc15; }
        .lp-score-low .lp-score-badge  { color: #f87171; }

        /* Light mode overrides for scoring section */
        [data-theme="light"] .lp-scoring {
          background: #f6f8fa;
          border-color: rgba(0,0,0,0.06);
        }

        [data-theme="light"] .lp-scoring-header h2 { color: #111827; }
        [data-theme="light"] .lp-scoring-header p  { color: rgba(0,0,0,0.5); }
        [data-theme="light"] .lp-signal-row        { border-color: rgba(0,0,0,0.05); }
        [data-theme="light"] .lp-signal-group-label { border-color: rgba(0,0,0,0.08); }
        [data-theme="light"] .lp-signal-label      { color: rgba(0,0,0,0.6); }
        [data-theme="light"] .lp-signal-divider    { background: rgba(0,0,0,0.07); }
        [data-theme="light"] .lp-scoring-note p    { color: rgba(0,0,0,0.35); }
        [data-theme="light"] .lp-score-example     { color: rgba(0,0,0,0.55); }

        /* Responsive — stack columns on mobile */
        @media (max-width: 640px) {
          .lp-scoring-grid {
            grid-template-columns: 1fr;
            gap: 40px 0;
          }
          .lp-signal-divider { display: none; }
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
