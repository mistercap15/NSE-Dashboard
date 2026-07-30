/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // Simple system fonts — no web-font loading, clean everywhere.
        display: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        body:    ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        // Numbers stay monospaced for column alignment, but a plain system mono.
        mono:    ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
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
        "scan":       "scan 1.1s ease-in-out infinite",
        "sparkle":    "sparkle 1.6s ease-in-out infinite",
        "ring-spin":  "ringSpin 1s linear infinite",
        "pop-in":     "popIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both",
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(12px)" }, to: { opacity: 1, transform: "none" } },
        scan: {
          "0%":   { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
        sparkle: {
          "0%,100%": { transform: "scale(1) rotate(0deg)",   opacity: 1 },
          "50%":     { transform: "scale(1.18) rotate(12deg)", opacity: 0.85 },
        },
        ringSpin: { to: { transform: "rotate(360deg)" } },
        popIn: {
          from: { opacity: 0, transform: "scale(0.94) translateY(8px)" },
          to:   { opacity: 1, transform: "none" },
        },
      },
    },
  },
  plugins: [],
};
