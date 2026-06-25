import type { Config } from "tailwindcss";

export default {
  content: [
    "./app.vue",
    "./components/**/*.{vue,js,ts}",
    "./layouts/**/*.vue",
    "./pages/**/*.vue"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        meet: {
          ink: "#202124",
          muted: "#5f6368",
          line: "#dadce0",
          panel: "#f8fafd",
          blue: "#1a73e8",
          green: "#188038",
          red: "#d93025",
          dark: "#111827"
        }
      },
      boxShadow: {
        soft: "0 14px 40px rgba(60, 64, 67, 0.16)"
      }
    }
  },
  plugins: []
} satisfies Config;
