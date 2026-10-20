/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#081325',
          900: '#0b1b33',
          800: '#132a4a',
          700: '#1d3a63',
          300: '#9fb3cf',
          200: '#c7d4e6',
        },
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-left': { from: { opacity: '0', transform: 'translateX(-12px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(12px)' }, to: { opacity: '1', transform: 'none' } },
        'grow-x': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(15, 118, 110, 0.35)' },
          '50%': { transform: 'scale(1.06)', boxShadow: '0 0 0 6px rgba(15, 118, 110, 0)' },
        },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        'fade-in': 'fade-in 250ms ease-out backwards',
        'fade-up': 'fade-up 300ms ease-out backwards',
        'slide-in-left': 'slide-in-left 300ms ease-out backwards',
        'slide-in-right': 'slide-in-right 250ms ease-out backwards',
        'grow-x': 'grow-x 600ms cubic-bezier(0.22, 1, 0.36, 1) backwards',
        breathe: 'breathe 1.6s ease-in-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
