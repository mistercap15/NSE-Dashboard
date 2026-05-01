/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono:    ["'IBM Plex Mono'", "monospace"],
        display: ["'Syne'", "sans-serif"],
        body:    ["'DM Sans'", "sans-serif"],
      },
      colors: {
        bg:      "#080C14",
        surface: "#0D1220",
        card:    "#111827",
        border:  "#1E2A3E",
        muted:   "#374151",
        dim:     "#6B7280",
        soft:    "#9CA3AF",
        text:    "#E5E9F0",
        accent:  "#00D4FF",
        green:   "#10B981",
        red:     "#EF4444",
        amber:   "#F59E0B",
        purple:  "#8B5CF6",
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
