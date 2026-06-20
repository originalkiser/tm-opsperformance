export default function TrademarkLogo({ size = 'md' }) {
  const sizes = {
    sm:  { width: 130, height: 72  },
    md:  { width: 200, height: 111 },
    lg:  { width: 300, height: 167 },
    xl:  { width: 400, height: 222 },
  }
  const { width, height } = sizes[size] || sizes.md

  return (
    <svg
      viewBox="0 0 300 167"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Trademark Car Wash - Powered by Strickland Brothers"
    >
      {/* Badge body */}
      <rect x="4" y="4" width="292" height="159" rx="14" fill="#0E2040"/>
      {/* Outer stroke */}
      <rect x="4" y="4" width="292" height="159" rx="14" fill="none" stroke="#1A3555" strokeWidth="2.5"/>
      {/* Inner decorative border */}
      <rect x="11" y="11" width="278" height="145" rx="10" fill="none" stroke="#8ECFCB" strokeWidth="1.2" opacity="0.45"/>

      {/* TRADEMARK */}
      <text
        x="150" y="52"
        textAnchor="middle"
        fill="#8ECFCB"
        fontSize="16"
        fontFamily="'Chakra Petch', Arial, sans-serif"
        fontWeight="600"
        letterSpacing="5"
      >
        TRADEMARK
      </text>

      {/* Divider line */}
      <line x1="40" y1="63" x2="260" y2="63" stroke="#8ECFCB" strokeWidth="0.8" opacity="0.35"/>

      {/* CAR WASH */}
      <text
        x="150" y="118"
        textAnchor="middle"
        fill="white"
        fontSize="52"
        fontFamily="'Chakra Petch', 'Arial Black', sans-serif"
        fontWeight="700"
        letterSpacing="2"
      >
        CAR WASH
      </text>

      {/* Divider line */}
      <line x1="40" y1="130" x2="260" y2="130" stroke="#8ECFCB" strokeWidth="0.8" opacity="0.35"/>

      {/* POWERED BY STRICKLAND BROTHERS */}
      <text
        x="150" y="150"
        textAnchor="middle"
        fill="#8ECFCB"
        fontSize="9.5"
        fontFamily="'Chakra Petch', Arial, sans-serif"
        fontWeight="600"
        letterSpacing="2"
      >
        POWERED BY STRICKLAND BROTHERS
      </text>
    </svg>
  )
}
