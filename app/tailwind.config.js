/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        'tm-navy':  '#0E2040',   // deepest navy — logo badge bg
        'tm-blue':  '#1A3555',   // primary navy — buttons, headers
        'tm-teal':  '#8ECFCB',   // teal mint — accents, labels
        'tm-sky':   '#A8DDD9',   // light sky teal — subtle backgrounds
        'tm-cream': '#EDEADE',   // warm cream — page background
      },
      fontFamily: {
        brand: ['"Chakra Petch"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
