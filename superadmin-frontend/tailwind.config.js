/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Match the Ultralytics platform's clean UI sans everywhere,
        // including any leftover `font-mono` usage in the codebase.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        // Neutral dark UI direction, matching the Ultralytics platform:
        // near-black grounds, soft gray borders, a single restrained
        // accent color instead of neon cyan/magenta.
        sa: {
          bg: '#0A0A0C',
          void: '#08080A',
          panel: '#141417',
          'panel-raised': '#1A1A1F',
          'panel-inset': '#0F0F12',
          line: '#26262C',
          'line-soft': '#1D1D22',
          'line-bright': '#3A3A42',
          ink: '#F2F2F5',
          'ink-dim': '#9B9BA5',
          'ink-faint': '#68686F',
          accent: '#4E8EFF',
          'accent-soft': '#132038',
          'accent-dim': '#1B2B4A',
          accent2: '#A855F7',
          'accent2-soft': '#221830',
          good: '#22C55E',
          'good-soft': '#0F2318',
          warn: '#F59E0B',
          'warn-soft': '#2B2008',
          critical: '#EF4444',
          'critical-soft': '#2B1414',
          brand: '#F5821F',
          'brand-soft': '#2B1B0A',
          'tile-blue': '#1E5F8C',
          'tile-green': '#12704F',
          'tile-amber': '#8A5A12',
          'tile-red': '#9F2B3F',
          'tile-purple': '#5B3A8E',
          'tile-teal': '#0E7C7B',
        },
      },
    },
  },
  plugins: [],
}
