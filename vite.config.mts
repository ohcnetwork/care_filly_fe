import federation from "@originjs/vite-plugin-federation";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { type Plugin, defineConfig } from "vite";

const require = createRequire(import.meta.url);
const vadDist =
  path.dirname(require.resolve("@ricky0123/vad-web/package.json")) + "/dist";
const ortDist = path.join(
  path.dirname(
    require.resolve("onnxruntime-web/package.json", { paths: [vadDist] }),
  ),
  "dist",
);
const VAD_VERSION: string = JSON.parse(
  readFileSync(path.join(vadDist, "../package.json"), "utf-8"),
).version;

const VAD_ASSETS: Array<[dir: string, file: string]> = [
  [vadDist, "silero_vad_v5.onnx"],
  [vadDist, "vad.worklet.bundle.min.js"],
  [ortDist, "ort-wasm.wasm"],
  [ortDist, "ort-wasm-simd.wasm"],
];

function vadAssets(): Plugin {
  return {
    name: "care-filly-vad-assets",
    generateBundle() {
      for (const [dir, file] of VAD_ASSETS) {
        this.emitFile({
          type: "asset",
          fileName: `vad/${VAD_VERSION}/${file}`,
          source: readFileSync(path.join(dir, file)),
        });
      }
    },
  };
}

export default defineConfig({
  envPrefix: "REACT_",
  define: {
    __VAD_VERSION__: JSON.stringify(VAD_VERSION),
  },
  plugins: [
    vadAssets(),
    federation({
      name: "care_filly_fe",
      filename: "remoteEntry.js",
      exposes: {
        "./manifest": "./src/manifest.ts",
      },
      shared: ["react", "react-dom", "react-i18next", "@tanstack/react-query"],
    }),
    tailwindcss(),
    react(),
  ],
  build: {
    target: "esnext",
    minify: false,
    cssCodeSplit: false,
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        format: "esm",
      },
      input: {
        main: "./src/index.tsx",
      },
    },
  },
  preview: {
    port: 10122,
    allowedHosts: true,
    host: "0.0.0.0",
    cors: {
      origin: "*",
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      credentials: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
