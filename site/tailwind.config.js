/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0F14",
        paper: "#131A22",
        "paper-raised": "#1A2330",
        "paper-border": "#232D3A",
        buy: "#35D07F",
        "buy-dim": "#1F7A4C",
        sell: "#FF5C5C",
        "sell-dim": "#992E2E",
        amber: "#F5A623",
        white: "#EDF1F5",
        "fog-bright": "#C3CBD6",
        fog: "#8B96A5",
        "fog-dim": "#5C6774",
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: { sm: "8px", md: "14px", lg: "22px" },
    },
  },
  plugins: [],
};
