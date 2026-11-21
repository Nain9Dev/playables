/**
 * Build every playable in games/ into build/games/<slug>/index.html (one file each).
 * Usage: node scripts/build-games.ts [slug]
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const gamesDir = join(root, "games");

const requested = process.argv[2];
const slugs = readdirSync(gamesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(gamesDir, entry.name, "index.html")))
  .map((entry) => entry.name)
  .filter((slug) => !requested || slug === requested)
  .sort();

if (slugs.length === 0) {
  console.error(requested ? `No playable named "${requested}" in games/.` : "No playables found in games/.");
  process.exit(1);
}

for (const slug of slugs) {
  console.log(`Building ${slug}`);
  await build({
    configFile: join(gamesDir, slug, "vite.config.ts"),
    logLevel: "warn",
  });
}

console.log(`Built ${slugs.length} playable${slugs.length === 1 ? "" : "s"}.`);
