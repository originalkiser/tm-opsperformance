// SVG recreation of the Trademark Car Wash badge logo.
// Layout matches the real logo: front-view car silhouette sitting on top of
// the navy badge panel. The car overlaps the badge top edge, rendered after
// the badge so it appears in front.
export default function TrademarkLogo({ size = 'md' }) {
  const sizes = {
    sm: { width: 140, height: 107 },
    md: { width: 220, height: 168 },
    lg: { width: 320, height: 244 },
    xl: { width: 440, height: 336 },
  }
  const { width, height } = sizes[size] || sizes.md

  return (
    <svg
      viewBox="0 0 400 305"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Trademark Car Wash - Powered by Strickland Brothers"
    >
      {/* ── Badge panel (rendered first so car sits on top) ── */}
      <rect x="12" y="118" width="376" height="179" rx="16" fill="#0E2040"/>
      <rect x="12" y="118" width="376" height="179" rx="16" fill="none" stroke="#1A3555" strokeWidth="3"/>
      <rect x="21" y="127" width="358" height="161" rx="12" fill="none" stroke="white" strokeWidth="1.5" opacity="0.55"/>

      {/* TRADEMARK */}
      <text x="200" y="168" textAnchor="middle"
            fill="#8ECFCB" fontSize="18"
            fontFamily="'Chakra Petch',Arial,sans-serif"
            fontWeight="600" letterSpacing="5">
        TRADEMARK
      </text>

      {/* CAR WASH */}
      <text x="200" y="238" textAnchor="middle"
            fill="white" fontSize="62"
            fontFamily="'Chakra Petch','Arial Black',sans-serif"
            fontWeight="700" letterSpacing="1">
        CAR WASH
      </text>

      {/* POWERED BY STRICKLAND BROTHERS */}
      <text x="200" y="274" textAnchor="middle"
            fill="#8ECFCB" fontSize="11"
            fontFamily="'Chakra Petch',Arial,sans-serif"
            fontWeight="600" letterSpacing="2">
        POWERED BY STRICKLAND BROTHERS
      </text>

      {/* ── Car: white halo outline (same path as body, slightly larger) ── */}
      <path
        d="M200,155
           L291,155 C311,155 322,148 324,137 C326,126 323,113 317,101
           L311,87 C304,70 296,53 281,39 C266,25 249,17 227,13
           L211,10 C205,9 200,9 200,9
           C200,9 195,9 189,10 L173,13
           C151,17 134,25 119,39 C104,53 96,70 89,87
           L83,101 C77,113 74,126 76,137 C78,148 89,155 109,155 Z"
        fill="white"
      />

      {/* ── Car body (navy fill on top of white halo) ── */}
      <path
        d="M200,151
           L286,151 C304,151 314,144 316,134 C318,124 315,112 310,101
           L304,88 C298,72 290,56 277,43 C264,30 248,22 227,18
           L212,15 C206,14 200,14 200,14
           C200,14 194,14 188,15 L173,18
           C152,22 136,30 123,43 C110,56 102,72 96,88
           L90,101 C85,112 82,124 84,134 C86,144 96,151 114,151 Z"
        fill="#0E2040"
      />

      {/* ── Windshield (teal tint, trapezoidal) ── */}
      <path
        d="M200,15
           C213,15 225,18 235,24 L244,33
           C250,42 252,53 249,63 L247,73
           L153,73 L151,63
           C148,53 150,42 156,33 L165,24
           C175,18 187,15 200,15 Z"
        fill="#8ECFCB" opacity="0.52"
      />

      {/* ── Left headlight ── */}
      <ellipse cx="108" cy="107" rx="22" ry="14" fill="#8ECFCB" opacity="0.72"/>

      {/* ── Right headlight ── */}
      <ellipse cx="292" cy="107" rx="22" ry="14" fill="#8ECFCB" opacity="0.72"/>

      {/* ── Grille stripes (5 horizontal lines) ── */}
      <rect x="160" y="99"  width="80" height="5" rx="2.5" fill="#8ECFCB" opacity="0.82"/>
      <rect x="156" y="109" width="88" height="5" rx="2.5" fill="#8ECFCB" opacity="0.82"/>
      <rect x="153" y="119" width="94" height="5" rx="2.5" fill="#8ECFCB" opacity="0.82"/>
      <rect x="153" y="129" width="94" height="5" rx="2.5" fill="#8ECFCB" opacity="0.82"/>
      <rect x="156" y="139" width="88" height="5" rx="2.5" fill="#8ECFCB" opacity="0.82"/>
    </svg>
  )
}
