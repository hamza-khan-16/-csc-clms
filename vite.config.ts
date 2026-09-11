import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    nitro(),
    react(),
  ],

  server: { port: 3000 },

  build: {
    // Raise chunk warning threshold — large PDF/XLSX libs are expected
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        // Split heavy libraries into separate chunks so they're cached
        // independently and not re-downloaded on every deploy
        manualChunks(id) {
          // PDF generation — only loaded on pages that export PDFs
          if (id.includes("jspdf") || id.includes("jspdf-autotable") || id.includes("html2canvas")) {
            return "vendor-pdf";
          }
          // Excel — only loaded on pages that export/import Excel
          if (id.includes("xlsx")) {
            return "vendor-xlsx";
          }
          // Charts — recharts + d3 deps
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-")) {
            return "vendor-charts";
          }
          // Supabase client
          if (id.includes("@supabase")) {
            return "vendor-supabase";
          }
          // TanStack (router + query) — core framework
          if (id.includes("@tanstack")) {
            return "vendor-tanstack";
          }
          // Radix UI primitives
          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }
        },
      },
    },

    // Enable source maps only in dev
    sourcemap: false,

    // Target modern browsers — smaller output, no need for legacy transforms
    target: "es2020",
  },

  // Pre-bundle these for faster dev server cold starts
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "@supabase/supabase-js",
      "@tanstack/react-query",
      "@tanstack/react-router",
    ],
    exclude: [
      // Don't pre-bundle heavy libs — they're loaded lazily
      "jspdf",
      "jspdf-autotable",
      "xlsx",
    ],
  },
});
