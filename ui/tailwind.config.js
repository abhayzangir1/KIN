/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--kin-font-family, system-ui)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        kin: {
          bg: 'var(--kin-bg)',
          surface: 'var(--kin-surface)',
          surfaceHover: 'var(--kin-surfaceHover)',
          card: 'var(--kin-card)',
          cardHover: 'var(--kin-cardHover)',
          border: 'var(--kin-border)',
          borderSubtle: 'var(--kin-borderSubtle)',
          primary: 'var(--kin-primary, #10b981)',
          primaryHover: '#059669',
          accent: 'var(--kin-accent, #00d2ff)',
          secondary: '#38bdf8',
          secondaryHover: '#0284c7',
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
