/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#08111f',
        shell: '#0d1a2b',
        mist: '#eaf4ff',
        chrome: '#7fd3ff',
        aurora: '#8bf3ff',
        frost: 'rgba(255,255,255,0.14)',
        line: 'rgba(255,255,255,0.08)',
      },
      boxShadow: {
        glass: '0 18px 45px rgba(0, 0, 0, 0.28)',
        glow: '0 0 0 1px rgba(127, 211, 255, 0.22), 0 18px 50px rgba(18, 58, 92, 0.32)',
      },
      fontFamily: {
        sans: ['"SF Pro Display"', '"Segoe UI"', 'sans-serif'],
        mono: ['"SF Mono"', '"Cascadia Code"', 'monospace'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      backdropBlur: {
        xs: '2px',
      },
      backgroundImage: {
        halo: 'radial-gradient(circle at top, rgba(127, 211, 255, 0.24), transparent 34%)',
      },
    },
  },
  plugins: [],
}
