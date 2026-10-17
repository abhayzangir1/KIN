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
          bg: 'var(--kin-bg)',
          surface: 'var(--kin-surface)',
          surfaceHover: 'var(--kin-surface)',
          card: 'var(--kin-card)',
          cardHover: 'var(--kin-card)',
          border: 'var(--kin-border)',
          borderSubtle: 'var(--kin-border)',
          primary: '#38bdf8',
          primaryHover: '#0284c7',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          text: 'var(--kin-text)',
          muted: 'var(--kin-muted)',
          subtle: 'var(--kin-subtle)',
        }
      }
    },
  },
  plugins: [],
}
