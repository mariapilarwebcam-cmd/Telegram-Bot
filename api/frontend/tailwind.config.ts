import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f0f13',
        surface: '#1a1a24',
        surfaceHighlight: '#252532',
        primary: '#ff2a6d',
        primaryDark: '#d41a55',
        secondary: '#7b2cbf',
        accent: '#05d5ff',
        textMain: '#e0e0e6',
        textMuted: '#8b8b9e',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #ff2a6d 0%, #7b2cbf 100%)',
        'gradient-glass': 'linear-gradient(145deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
      }
    },
  },
  plugins: [],
}
export default config