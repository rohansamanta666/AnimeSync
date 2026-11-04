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
        void: {
          950: '#06070a',
          900: '#0a0b10', // Near-black background
          800: '#121526', // Dark navy secondary surface
          700: '#181c34', // Elevated surface
          600: '#232846', // Card borders / dividers
          500: '#323962',
        },
        violet: {
          accent: '#8b5cf6',
          glow: '#7c3aed',
        },
        pink: {
          accent: '#ec4899',
          glow: '#f43f5e',
        },
        cyan: {
          accent: '#06b6d4',
          glow: '#22d3ee',
        },
        ink: {
          text: '#f8fafc', // Off-white primary text
          muted: '#94a3b8', // Cool grey secondary text
          dim: '#64748b',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Noto Sans JP', 'sans-serif'],
      },
      boxShadow: {
        'glow-violet': '0 0 20px -3px rgba(139, 92, 246, 0.3)',
        'glow-pink': '0 0 20px -3px rgba(236, 72, 153, 0.3)',
        'glow-cyan': '0 0 20px -3px rgba(6, 182, 212, 0.3)',
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}

