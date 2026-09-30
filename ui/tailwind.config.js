/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        kin: {
          bg: '#0B0F17',
          surface: '#121826',
          card: '#1A2234',
          border: '#2A364F',
          primary: '#3B82F6',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          text: '#F3F4F6',
          muted: '#9CA3AF',
        }
      }
    },
  },
  plugins: [],
}
