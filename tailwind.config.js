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
      // Material 3 motion easing: standard for small changes, emphasized for elements entering or leaving.
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        'emphasized-decelerate': 'cubic-bezier(0.05, 0.7, 0.1, 1)',
        'emphasized-accelerate': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(20px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-left': { from: { opacity: '0', transform: 'translateX(-32px) scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(32px) scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        'grow-x': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        // Material "fade through": the new page fades in while settling from a slightly smaller size.
        'fade-through': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        // Material "shared axis" on X: moving to the next tab enters from the right, going back from the left.
        'axis-forward': { from: { opacity: '0', transform: 'translateX(48px)' }, to: { opacity: '1', transform: 'none' } },
        'axis-back': { from: { opacity: '0', transform: 'translateX(-48px)' }, to: { opacity: '1', transform: 'none' } },
        pop: {
          '0%': { opacity: '0', transform: 'scale(0.6)' },
          '60%': { opacity: '1', transform: 'scale(1.08)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        ripple: { from: { opacity: '0.28', transform: 'scale(0)' }, to: { opacity: '0', transform: 'scale(1)' } },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(15, 118, 110, 0.45)' },
          '50%': { transform: 'scale(1.12)', boxShadow: '0 0 0 10px rgba(15, 118, 110, 0)' },
        },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        'fade-in': 'fade-in 300ms cubic-bezier(0.2, 0, 0, 1) backwards',
        'fade-up': 'fade-up 500ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        'slide-in-left': 'slide-in-left 500ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        'slide-in-right': 'slide-in-right 450ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        'grow-x': 'grow-x 1000ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        'fade-through': 'fade-through 350ms cubic-bezier(0.05, 0.7, 0.1, 1) 60ms backwards',
        'axis-forward': 'axis-forward 450ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        'axis-back': 'axis-back 450ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards',
        pop: 'pop 450ms cubic-bezier(0.2, 0, 0, 1) backwards',
        ripple: 'ripple 550ms cubic-bezier(0.2, 0, 0, 1) forwards',
        breathe: 'breathe 1.4s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
