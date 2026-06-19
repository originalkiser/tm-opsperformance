/**
 * SVG recreation of the Trademark Car Wash logo.
 * Colors match the official trademark badge: navy #0E2040, teal #8ECFCB, white.
 */
export default function TrademarkLogo({ size = 'md' }) {
  const sizes = {
    sm:  { width: 130, height: 86  },
    md:  { width: 200, height: 133 },
    lg:  { width: 300, height: 200 },
    xl:  { width: 400, height: 267 },
  }
  const { width, height } = sizes[size] || sizes.md

  return (
    <svg
      viewBox="0 0 300 200"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Trademark Car Wash - Powered by Strickland Brothers"
    >
      {/* ── Car silhouette (front view) ── */}
      <g transform="translate(150, 64)">
        {/* White outline glow behind car */}
        <ellipse cx="0" cy="8" rx="62" ry="32" fill="white" opacity="0.15"/>

        {/* Car body – wide lower section */}
        <path
          d="M-60,32 Q-62,20 -58,12 L-50,4 L50,4 L58,12 Q62,20 60,32 Z"
          fill="#0E2040" stroke="white" strokeWidth="2.5" strokeLinejoin="round"
        />
        {/* Cabin / roof */}
        <path
          d="M-32,4 Q-24,-18 -10,-26 Q0,-30 10,-26 Q24,-18 32,4 Z"
          fill="#0E2040" stroke="white" strokeWidth="2.5" strokeLinejoin="round"
        />
        {/* Windshield tint */}
        <path
          d="M-24,3 Q-16,-14 -6,-21 Q0,-24 6,-21 Q16,-14 24,3 Z"
          fill="#8ECFCB" opacity="0.55"
        />
        {/* Left headlight */}
        <ellipse cx="-46" cy="20" rx="10" ry="7" fill="#0E2040" stroke="white" strokeWidth="2"/>
        {/* Right headlight */}
        <ellipse cx="46" cy="20" rx="10" ry="7" fill="#0E2040" stroke="white" strokeWidth="2"/>
        {/* Grille stripes */}
        <rect x="-16" y="14" width="32" height="2.5" rx="1.2" fill="#8ECFCB" opacity="0.85"/>
        <rect x="-16" y="20" width="32" height="2.5" rx="1.2" fill="#8ECFCB" opacity="0.85"/>
        <rect x="-13" y="26" width="26" height="2.5" rx="1.2" fill="#8ECFCB" opacity="0.85"/>
      </g>

      {/* ── Badge body ── */}
      <rect x="6" y="62" width="288" height="128" rx="14" fill="#0E2040"/>
      {/* Outer stroke */}
      <rect x="6" y="62" width="288" height="128" rx="14" fill="none" stroke="#1A3555" strokeWidth="2.5"/>
      {/* Inner decorative border */}
      <rect x="13" y="69" width="274" height="114" rx="10" fill="none" stroke="#8ECFCB" strokeWidth="1.2" opacity="0.45"/>

      {/* ── TRADEMARK text ── */}
      <text
        x="150" y="97"
        textAnchor="middle"
        fill="#8ECFCB"
        fontSize="15"
        fontFamily="'Chakra Petch', 'Arial', sans-serif"
        fontWeight="600"
        letterSpacing="4"
      >
        TRADEMARK
      </text>

      {/* ── CAR WASH text ── */}
      <text
        x="150" y="143"
        textAnchor="middle"
        fill="white"
        fontSize="44"
        fontFamily="'Chakra Petch', 'Arial Black', sans-serif"
        fontWeight="700"
        letterSpacing="3"
      >
        CAR WASH
      </text>

      {/* ── POWERED BY STRICKLAND BROTHERS ── */}
      <text
        x="150" y="168"
        textAnchor="middle"
        fill="#8ECFCB"
        fontSize="9.5"
        fontFamily="'Chakra Petch', 'Arial', sans-serif"
        fontWeight="600"
        letterSpacing="2"
      >
        POWERED BY STRICKLAND BROTHERS
      </text>
    </svg>
  )
}
