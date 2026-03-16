const ICONS = {
  house: (stroke) => (
    <g fill="none" stroke={stroke} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,20 22,4 40,20"/>
      <rect x="8" y="20" width="28" height="22" rx="1"/>
      <rect x="16" y="28" width="12" height="14"/>
    </g>
  ),
  apartment: (stroke) => (
    <g fill="none" stroke={stroke} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="10" width="40" height="32" rx="1"/>
      <polyline points="2,10 22,2 42,10"/>
      <rect x="7" y="16" width="7" height="7"/>
      <rect x="18" y="16" width="7" height="7"/>
      <rect x="29" y="16" width="7" height="7"/>
      <rect x="7" y="27" width="7" height="7"/>
      <rect x="18" y="27" width="7" height="7"/>
      <rect x="29" y="27" width="7" height="7"/>
    </g>
  ),
  pin: (stroke) => (
    <g fill="none" stroke={stroke} strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M22,3 C13,3 6,10 6,19 C6,30 22,44 22,44
               C22,44 38,30 38,19 C38,10 31,3 22,3 Z"/>
      <circle cx="22" cy="19" r="6"/>
    </g>
  ),
}

// [left%, top%, iconType, rotation, opacity, size]
// 10 rows × 6 columns, even rows offset by ~half a column
const POSITIONS = [
  // Row 1
  [ 4,  2,  'house',      -12, 0.85, 38],
  [20,  1,  'apartment',    6, 0.80, 42],
  [38,  3,  'pin',          0, 0.85, 36],
  [55,  2,  'house',       10, 0.80, 40],
  [72,  4,  'apartment',   -7, 0.85, 38],
  [88,  1,  'pin',          5, 0.80, 36],
  // Row 2 (offset)
  [11, 11,  'pin',          8, 0.75, 36],
  [28, 12,  'house',       -5, 0.80, 42],
  [46, 10,  'apartment',    0, 0.75, 38],
  [63, 11,  'pin',        -10, 0.80, 36],
  [80, 13,  'house',        7, 0.75, 40],
  [95, 10,  'apartment',   -4, 0.80, 34],
  // Row 3
  [ 3, 21,  'apartment',    5, 0.75, 40],
  [20, 22,  'pin',         -8, 0.80, 36],
  [37, 20,  'house',        0, 0.75, 42],
  [54, 21,  'apartment',    9, 0.80, 36],
  [71, 23,  'pin',         -5, 0.75, 38],
  [88, 20,  'house',        7, 0.80, 40],
  // Row 4 (offset)
  [ 9, 31,  'house',      -10, 0.75, 38],
  [26, 30,  'pin',          4, 0.80, 36],
  [44, 32,  'apartment',   -2, 0.75, 42],
  [61, 31,  'house',        8, 0.80, 38],
  [78, 30,  'pin',         -6, 0.75, 36],
  [94, 32,  'apartment',    3, 0.80, 40],
  // Row 5
  [ 5, 41,  'pin',          6, 0.75, 36],
  [22, 42,  'house',       -9, 0.80, 40],
  [40, 40,  'apartment',    2, 0.75, 38],
  [57, 41,  'pin',         11, 0.80, 36],
  [74, 43,  'house',       -4, 0.75, 42],
  [91, 40,  'apartment',    7, 0.80, 38],
  // Row 6 (offset)
  [12, 51,  'apartment',   -7, 0.75, 40],
  [29, 52,  'pin',          3, 0.80, 36],
  [47, 50,  'house',       -1, 0.75, 42],
  [64, 51,  'apartment',   10, 0.80, 38],
  [81, 53,  'pin',         -8, 0.75, 36],
  [96, 50,  'house',        5, 0.80, 40],
  // Row 7
  [ 4, 61,  'house',       -6, 0.75, 38],
  [21, 62,  'apartment',    8, 0.80, 42],
  [38, 60,  'pin',         -3, 0.75, 36],
  [55, 61,  'house',       12, 0.80, 40],
  [72, 63,  'apartment',   -9, 0.75, 38],
  [89, 60,  'pin',          4, 0.80, 36],
  // Row 8 (offset)
  [10, 71,  'pin',          7, 0.75, 36],
  [27, 70,  'apartment',   -5, 0.80, 40],
  [44, 72,  'house',        1, 0.75, 42],
  [61, 71,  'pin',         -9, 0.80, 36],
  [78, 73,  'apartment',    6, 0.75, 38],
  [93, 70,  'house',       -3, 0.80, 40],
  // Row 9
  [ 3, 81,  'apartment',    9, 0.70, 40],
  [20, 82,  'house',       -7, 0.75, 38],
  [37, 80,  'pin',          2, 0.70, 36],
  [54, 81,  'apartment',  -11, 0.75, 42],
  [71, 83,  'house',        5, 0.70, 40],
  [87, 80,  'pin',         -4, 0.75, 36],
  // Row 10 (offset)
  [ 9, 91,  'house',       -8, 0.65, 38],
  [26, 92,  'pin',          6, 0.70, 36],
  [43, 90,  'apartment',   -2, 0.65, 40],
  [60, 91,  'house',        9, 0.70, 42],
  [77, 93,  'pin',         -6, 0.65, 36],
  [93, 90,  'apartment',    4, 0.70, 38],
]

export function BackgroundPattern({ theme }) {
  const stroke = theme === 'dark'
    ? 'rgba(245,166,35,0.18)'
    : 'rgba(0,0,0,0.09)'

  const fadeColor = theme === 'dark' ? '#0d0d14' : '#f3f4f6'

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 0,
      overflow: 'hidden',
    }}>
      {POSITIONS.map(([lp, tp, icon, rot, op, size], i) => {
        const IconFn = ICONS[icon]
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${lp}%`,
              top: `${tp}%`,
              opacity: op,
              transform: `rotate(${rot}deg)`,
            }}
          >
            <svg
              width={size}
              height={size}
              viewBox="0 0 44 44"
              xmlns="http://www.w3.org/2000/svg"
            >
              {IconFn(stroke)}
            </svg>
          </div>
        )
      })}

      {/* Very subtle fade only at the very bottom */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '8%',
        background: `linear-gradient(to bottom, transparent 0%, ${fadeColor} 100%)`,
      }}/>
    </div>
  )
}
