/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f7f7f4',
        ink: '#26251e',
        body: '#5a5852',
        muted: '#807d72',
        hairline: '#e6e5e0',
        brand: '#f54e00',
      },
    },
  },
  plugins: [],
}

export default config
