import type { Config } from 'tailwindcss'

// This source archive omitted the original configuration. These tokens match
// globals.css (comma-separated HSL), including Tailwind opacity modifiers.
const color = (name: string) => `hsla(var(--${name}), <alpha-value>)`
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: { sans: ['Arial', 'Microsoft YaHei', 'PingFang SC', 'sans-serif'] },
      colors: {
        border: color('border'), input: color('input'), ring: color('ring'),
        background: color('background'), foreground: color('foreground'),
        ...Object.fromEntries(['primary', 'secondary', 'destructive', 'muted', 'accent', 'popover', 'card'].map(name => [name, { DEFAULT: color(name), foreground: color(`${name}-foreground`) }])),
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
}
export default config
