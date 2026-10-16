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
        cyber: {
          bg: '#05070B',
          panel: '#0B0F19',
          card: '#111726',
          border: '#1F293D',
          cyan: '#00F0FF',
          emerald: '#00FF9D',
          amber: '#FFB800',
          crimson: '#FF2A55',
          purple: '#A855F7',
          blue: '#3B82F6',
          muted: '#64748B'
        }
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        display: ['"DM Sans"', 'sans-serif'],
        mono: ['"DM Sans"', 'sans-serif'],
        hud: ['"DM Sans"', 'sans-serif'],
      },
      boxShadow: {
        'neon-cyan': '0 0 20px rgba(0, 240, 255, 0.35)',
        'neon-emerald': '0 0 20px rgba(0, 255, 157, 0.35)',
        'neon-crimson': '0 0 20px rgba(255, 42, 85, 0.45)',
        'neon-amber': '0 0 20px rgba(255, 184, 0, 0.35)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'laser-sweep': 'sweep 2.5s ease-in-out infinite',
        'radar': 'radarSweep 4s linear infinite',
      },
      keyframes: {
        sweep: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '50%': { transform: 'rotate(180deg)' },
        },
        radarSweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        }
      }
    },
  },
  plugins: [],
}
