/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        'tm-navy':  '#0E2040',
        'tm-blue':  '#1A3555',
        'tm-teal':  '#8ECFCB',
        'tm-sky':   '#A8DDD9',
        'tm-cream': '#EDEADE',
        // Dark mode palette — brand-true navy foundation
        'tm-dark-bg':      '#0A1A2E',
        'tm-dark-surface': '#112240',
        'tm-dark-card':    '#1A3350',
        'tm-dark-border':  '#1E3A5F',
        'tm-dark-text':    '#D6E4F0',
        'tm-dark-muted':   '#7A9BBF',
        'tm-dark-nav':     '#071428',
        'tm-dark-row-alt': '#0F2035',
      },
      fontFamily: {
        brand: ['"Chakra Petch"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
