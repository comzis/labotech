/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy tokens kept for existing panel components
        brand: {
          900: '#080808',
          800: '#0f0f0f',
          700: '#141414',
          600: '#1e1e1e',
          500: '#2a2a2a',
          400: '#383838',
        },
        neon: {
          cyan:   '#00ddff',
          blue:   '#2299ff',
          purple: '#cc44ff',
          green:  '#00dd55',
        },
        midnight: {
          base:    '#080808',
          surface: '#141414',
          glass:   'rgba(20,20,20,0.85)',
        },
        // Rack design tokens
        rack: {
          bg:     '#080808',   // chassis / room background
          frame:  '#0f0f0f',   // rack frame
          panel:  '#141414',   // panel face
          bezel:  '#1c1c1c',   // bezel bar
          rail:   '#252525',   // rack rails & borders
          screw:  '#111111',   // screw hole centre
          groove: '#0a0a0a',   // deep shadow lines
        },
        // Broadcast LED palette (Evertz / Grass Valley style)
        led: {
          green:  '#00dd55',
          amber:  '#ffaa00',
          red:    '#ff2233',
          blue:   '#2299ff',
          cyan:   '#00ddff',
          purple: '#cc44ff',
          teal:   '#00ddaa',
          off:    '#1c1c1c',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      animation: {
        'led-pulse':  'ledPulse 2s ease-in-out infinite alternate',
        'led-blink':  'ledBlink 0.6s step-end infinite',
        'glow-pulse': 'glow 3s ease-in-out infinite alternate',
        'float':      'float 6s ease-in-out infinite',
      },
      keyframes: {
        ledPulse: {
          '0%':   { opacity: '0.7' },
          '100%': { opacity: '1'   },
        },
        ledBlink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
        glow: {
          '0%':   { boxShadow: '0 0 10px rgba(0,221,85,0.1)'  },
          '100%': { boxShadow: '0 0 25px rgba(0,221,85,0.35)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)'    },
          '50%':      { transform: 'translateY(-8px)' },
        },
      },
    },
  },
  plugins: [],
};
