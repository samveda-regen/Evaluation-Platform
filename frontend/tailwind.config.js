/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#FFF8F4',
          100: '#FFF0E4',
          200: '#FCD8B7',
          300: '#F4B27E',
          400: '#E8924F',
          500: '#E07B3C',
          600: '#C9651F',
          700: '#A85119',
          800: '#8B4116',
          900: '#6D3210',
        },
        navy: {
          DEFAULT: '#1F3556',
          deep:    '#142340',
          soft:    '#2C4773',
        },
      }
    },
  },
  plugins: [],
}
