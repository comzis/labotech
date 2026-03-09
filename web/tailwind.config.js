/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          900: '#0A0A0B',
          800: '#111113',
          700: '#1a1a1e',
          600: '#232328',
          500: '#2d2d34',
          400: '#383840',
        },
        slate: {
          950: '#020617',
        },
        neon: {
          cyan: '#22D3EE',
          blue: '#3B82F6',
          purple: '#A855F7'
        },
        midnight: {
          base: '#0A0A0B',
          surface: '#111113',
          glass: 'rgba(10, 10, 11, 0.65)',
        }
      },
      animation: {
        'glow-pulse': 'glow 3s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 10px rgba(34, 211, 238, 0.1)' },
          '100%': { boxShadow: '0 0 25px rgba(34, 211, 238, 0.4)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        }
      }
    },
  },
  plugins: [],
};
