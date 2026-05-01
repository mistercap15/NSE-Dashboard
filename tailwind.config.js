/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["Cabinet Grotesk", "sans-serif"],
        body:    ["Satoshi", "sans-serif"],
        mono:    ["JetBrains Mono", "monospace"],
      },
      colors: {
        bg:      "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        card:    "rgb(var(--color-card) / <alpha-value>)",
        border:  "rgb(var(--color-border) / <alpha-value>)",
        muted:   "rgb(var(--color-muted) / <alpha-value>)",
        dim:     "rgb(var(--color-dim) / <alpha-value>)",
        soft:    "rgb(var(--color-soft) / <alpha-value>)",
        text:    "rgb(var(--color-text) / <alpha-value>)",
        accent:  "rgb(var(--color-accent) / <alpha-value>)",
        green:   "rgb(var(--color-green) / <alpha-value>)",
        red:     "rgb(var(--color-red) / <alpha-value>)",
        amber:   "rgb(var(--color-amber) / <alpha-value>)",
        purple:  "rgb(var(--color-purple) / <alpha-value>)",
      },
      animation: {
        "fade-in":    "fadeIn 0.4s ease forwards",
        "slide-up":   "slideUp 0.35s ease forwards",
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(12px)" }, to: { opacity: 1, transform: "none" } },
      },
    },
  },
  plugins: [],
};
