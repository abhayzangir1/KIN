/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        kin: {
          bg: '#0d1117',
          surface: '#161b22',
          surfaceHover: '#1c2128',
          card: '#21262d',
          cardHover: '#292e36',
          border: 'rgba(255, 255, 255, 0.08)',
          borderSubtle: 'rgba(255, 255, 255, 0.04)',
          primary: '#38bdf8',
          primaryHover: '#0284c7',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          text: '#f0f6fc',
          muted: '#8b949e',
          subtle: '#6e7681',
        }
      }
    },
  },
  plugins: [],
}
