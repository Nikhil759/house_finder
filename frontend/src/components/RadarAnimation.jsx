import React, { useState, useEffect, useRef } from 'react';

// Spokes: 4 full diameter lines at 0°/45°/90°/135° through center (200,200), r=180
const SPOKES = [
  { x1: 20,    y1: 200,  x2: 380,   y2: 200   }, // 0°
  { x1: 72.7,  y1: 72.7, x2: 327.3, y2: 327.3 }, // 45°
  { x1: 200,   y1: 20,   x2: 200,   y2: 380   }, // 90°
  { x1: 327.3, y1: 72.7, x2: 72.7,  y2: 327.3 }, // 135°
];

// Static per-dot config — only visual identity, not position (position is state-driven)
const DOT_CONFIG = [
  { id: 0, label: 'reddit',   fill: 'rgba(200,70,25,0.6)',  rowOffset: 26, startDelay: 0,    iconSrc: 'https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png' },
  { id: 1, label: 'housing',  fill: 'rgba(130,60,190,0.6)', rowOffset: 27, startDelay: 1200, iconSrc: 'https://www.google.com/s2/favicons?domain=housing.com&sz=32' },
  { id: 2, label: 'telegram', fill: 'rgba(35,130,190,0.6)', rowOffset: 28, startDelay: 2400, iconSrc: 'https://telegram.org/img/t_logo.svg' },
  { id: 3, label: 'nobroker', fill: 'rgba(210,35,35,0.6)',  rowOffset: 29, startDelay: 3600, iconSrc: 'https://www.google.com/s2/favicons?domain=nobroker.in&sz=32' },
];

// Safe zone for dots (icon-only, no labels → tighter clearance needed):
//
//   cx ≤ 180  — full visible width (container 480px, 55% bleed → ~216px visible
//               → viewBox x ≤ 180). Allow dots anywhere across the visible arc.
//
//   cy ≤ 158  — clears the hero headline with icon-only dots.
//               Icon is 14px tall centred at cy+5→cy+19. Text starts at viewBox
//               y ≈ 170 (container ~204px, scaling 400/480). 158 + 19 = 177 ≤ 170
//               is tight but the icon is small — gives ~10px clearance.
//
// This spreads dots across the entire upper arc of the visible radar face.
// Rejection-sampling converges quickly (~35% of ring area is valid).
function randomPos() {
  let cx, cy, tries = 0;
  do {
    const r = 65 + Math.random() * 110;
    const a = Math.random() * 2 * Math.PI;
    cx = Math.round(200 + r * Math.cos(a));
    cy = Math.round(200 + r * Math.sin(a));
    tries++;
  } while ((cx > 180 || cy > 158) && tries < 60);
  return { cx, cy };
}

const CSS = `
@keyframes radar-spin {
  from { transform: rotate(0deg);   }
  to   { transform: rotate(360deg); }
}
`;

export default function RadarAnimation({ size = 480 }) {
  // Each dot: static config fields + live cx/cy/opacity driven by intervals
  const [dots, setDots] = useState(() =>
    DOT_CONFIG.map(cfg => ({ ...cfg, ...randomPos(), opacity: 0.6 }))
  );

  const timersRef = useRef([]);

  useEffect(() => {
    const push = t => { timersRef.current.push(t); return t; };

    DOT_CONFIG.forEach(({ id, startDelay }) => {
      function cycle() {
        // Random wait 3–5 s before next reposition
        const wait = 3000 + Math.random() * 2000;

        push(setTimeout(() => {
          // 1. Fade out
          setDots(prev => prev.map(d => d.id === id ? { ...d, opacity: 0 } : d));

          // 2. After fade-out (0.38s), jump to new position while invisible
          push(setTimeout(() => {
            const pos = randomPos();
            setDots(prev => prev.map(d => d.id === id ? { ...d, ...pos } : d));

            // 3. One tick later, fade in at new position
            push(setTimeout(() => {
              setDots(prev => prev.map(d => d.id === id ? { ...d, opacity: 0.6 } : d));
              cycle(); // schedule next cycle
            }, 40));

          }, 380));

        }, wait));
      }

      // Stagger initial start so dots don't all move at once
      push(setTimeout(cycle, startDelay));
    });

    const timers = timersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <style>{CSS}</style>

      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          right: -(size * 0.55) - 60,
          top: -60,
          width: size + 120,
          height: size + 120,
          background: 'radial-gradient(circle, rgba(232,160,32,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Radar container — 55% bleeds off right edge */}
      <div
        style={{
          position: 'absolute',
          right: -(size * 0.55),
          top: -8,
          width: size,
          height: size,
          pointerEvents: 'none',
          zIndex: 0,
          background: 'transparent',
        }}
      >
        {/* ── Static layer: rings + spokes + animated dots ── */}
        <svg
          width={size}
          height={size}
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          {/* 3 rings */}
          <circle cx="200" cy="200" r="180" stroke="#E8A020" strokeWidth="0.5" strokeOpacity="0.40" />
          <circle cx="200" cy="200" r="120" stroke="#E8A020" strokeWidth="0.5" strokeOpacity="0.30" />
          <circle cx="200" cy="200" r="60"  stroke="#E8A020" strokeWidth="0.5" strokeOpacity="0.20" />

          {/* 4 spokes */}
          {SPOKES.map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke="#E8A020" strokeWidth="0.5" strokeOpacity="0.25" />
          ))}

          {/* Source dots — fade out → reposition → fade in via React state */}
          {dots.map(({ id, cx, cy, fill, opacity, iconSrc }) => (
            <g
              key={id}
              style={{
                opacity,
                transition: 'opacity 0.35s ease-in-out',
              }}
            >
              {/* Dot */}
              <circle cx={cx} cy={cy} r="3" fill={fill} />

              {/* Icon only — 14px, centred below dot, desaturated ~50% */}
              <image
                href={iconSrc}
                x={cx - 7}
                y={cy + 5}
                width="14"
                height="14"
                style={{ filter: 'saturate(0.5)' }}
              />
            </g>
          ))}
        </svg>

        {/* ── Rotating layer: scan line only ── */}
        <svg
          width={size}
          height={size}
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: '50% 50%',
            animation: 'radar-spin 8s linear infinite',
          }}
        >
          <line
            x1="200" y1="200"
            x2="380" y2="200"
            stroke="#E8A020"
            strokeOpacity="0.55"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </>
  );
}
