/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cyberpunk direction: void-black ground, cyan as the primary
        // signal color, magenta reserved for the "ghost / watching" state.
        sa: {
          bg: '#07050D',
          void: '#040309',
          panel: '#0D0A18',
          'panel-raised': '#141026',
          'panel-inset': '#08060F',
          line: '#241B3D',
          'line-soft': '#1A1430',
          'line-bright': '#3D2E66',
          ink: '#EAF6FF',
          'ink-dim': '#8D8FB8',
          'ink-faint': '#56587A',
          accent: '#00F0FF',
          'accent-soft': '#062430',
          'accent-dim': '#0A3D47',
          accent2: '#FF2ED1',
          'accent2-soft': '#2A0A28',
          good: '#39FF88',
          'good-soft': '#062A1A',
          warn: '#FFD426',
          'warn-soft': '#2B2205',
          critical: '#FF2E63',
          'critical-soft': '#2B0716',
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 1px rgba(0,240,255,0.9), 0 0 14px rgba(0,240,255,0.45)',
        'glow-cyan-sm': '0 0 1px rgba(0,240,255,0.9), 0 0 6px rgba(0,240,255,0.5)',
        'glow-magenta': '0 0 1px rgba(255,46,209,0.9), 0 0 14px rgba(255,46,209,0.4)',
        'glow-green': '0 0 1px rgba(57,255,136,0.9), 0 0 10px rgba(57,255,136,0.4)',
        'glow-red': '0 0 1px rgba(255,46,99,0.9), 0 0 10px rgba(255,46,99,0.45)',
      },
    },
  },
  plugins: [],
}
