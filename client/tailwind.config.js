/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        slate: {
          950: '#0F172A',
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
          600: '#475569',
          500: '#64748B',
          400: '#94A3B8',
        },
        accent: '#06B6D4',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      borderRadius: {
        card: '16px',
        control: '8px',
      },
    },
  },
  plugins: [],
}
