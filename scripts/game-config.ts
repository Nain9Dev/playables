import { resolve } from "node:path";
import { defineConfig, type UserConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Shared Vite config for every playable. The ad networks accept one HTML file
 * with every asset inlined, so the build folds the JavaScript and CSS into
 * the page. `dir` is the playable's folder.
 */
export function defineGameConfig(dir: string, slug: string): UserConfig {
  return defineConfig({
    root: dir,
    base: "./",
    plugins: [viteSingleFile()],
    server: {
      // The shared kit lives two folders above each game.
      fs: { allow: [resolve(dir, "../..")] },
    },
    build: {
      outDir: resolve(dir, "../../build/games", slug),
      emptyOutDir: true,
      target: "es2019",
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      reportCompressedSize: false,
      // The default module-preload polyfill calls fetch(), and the network specs
      // forbid network calls. The validator caught this on the first build.
      modulePreload: false,
    },
  });
}
