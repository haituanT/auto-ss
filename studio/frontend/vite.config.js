import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const studioPort = process.env.STUDIO_PORT || "3101";
const backendTarget = `http://localhost:${studioPort}`;
const fileEnv = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
const studioAuthToken = process.env.VITE_STUDIO_AUTH_TOKEN
  || process.env.STUDIO_AUTH_TOKEN
  || fileEnv.VITE_STUDIO_AUTH_TOKEN
  || fileEnv.STUDIO_AUTH_TOKEN
  || "";

export default defineConfig({
  root: "studio/frontend",
  plugins: [react()],
  define: {
    "import.meta.env.VITE_STUDIO_AUTH_TOKEN": JSON.stringify(studioAuthToken),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": backendTarget,
      "/shared-assets": backendTarget,
      "/videos-media": backendTarget
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@remotion") || id.includes("node_modules/remotion")) {
            const match = id.match(/node_modules[\\/](?:@remotion[\\/]([^\\/]+)|remotion)[\\/]/);
            return match?.[1] ? `remotion-${match[1]}` : "remotion-core";
          }
          if (id.includes("react")) return "react-vendor";
          return "vendor";
        }
      }
    }
  }
});
