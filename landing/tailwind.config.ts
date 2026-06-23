import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        soft: "var(--soft)",
        panel: "var(--panel)",
        panel2: "var(--panel-2)",
        panel3: "var(--panel-3)",
        lime: "var(--lime)",
        limeInk: "var(--lime-ink)",
        danger: "var(--danger)",
        success: "var(--success)",
        warning: "var(--warning)",
      },
      boxShadow: {
        paygrid: "var(--shadow)",
      },
      borderRadius: {
        paygrid: "24px",
      },
    },
  },
  plugins: [],
};

export default config;
