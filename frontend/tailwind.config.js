/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "cream-bg": "#FAF8F5",
        "cream-surface": "#F5F1EB",
        "cream-divider": "#EAE4DC",
        "warm-text": "#24201D",
        "warm-muted": "#78716C",
        "warm-subtle": "#A8A199",
        "warm-accent": "#8A5122",
        "warm-accent-light": "#F7EFE8",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "sans-serif"],
        code: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};