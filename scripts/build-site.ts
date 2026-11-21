/**
 * Generate the portfolio into dist/ from the built playables.
 * Fail closed: a playable that breaks a network rule, or whose metadata is
 * incomplete, stops the build and nothing is published.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validatePlayable } from "../kit/validate.ts";
import { parseMeta } from "../site/meta.ts";
import { renderDetail, renderIndex, type SiteEntry, type SiteInfo } from "../site/render.ts";

const root = resolve(import.meta.dirname, "..");
const gamesDir = join(root, "games");
const builtDir = join(root, "build", "games");
const dist = join(root, "dist");

function countTests(): number {
  const dir = join(root, "tests");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.ts"))
    .reduce((sum, name) => sum + (readFileSync(join(dir, name), "utf8").match(/^\s*it\(/gm)?.length ?? 0), 0);
}

const threeVersion = (JSON.parse(readFileSync(join(root, "node_modules", "three", "package.json"), "utf8")) as { version: string }).version;

const info: SiteInfo = {
  repoUrl: "https://github.com/Nain9Dev/playables",
  contactEmail: "contact@naindev.com",
  threeVersion,
  testCount: countTests(),
};

const entries: SiteEntry[] = [];
let failed = false;

for (const dirent of readdirSync(gamesDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const slug = dirent.name;
  const metaPath = join(gamesDir, slug, "playable.json");
  const builtPath = join(builtDir, slug, "index.html");
  if (!existsSync(metaPath)) continue;

  const meta = parseMeta(JSON.parse(readFileSync(metaPath, "utf8")), slug);
  if (!existsSync(builtPath)) {
    console.error(`FAIL ${slug}: no build at build/games/${slug}/index.html. Run "npm run build:games" first.`);
    failed = true;
    continue;
  }

  const buffer = readFileSync(builtPath);
  const verdict = validatePlayable(buffer.toString("utf8"), statSync(builtPath).size);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const poster = join(gamesDir, slug, "poster.jpg");

  console.log(`${verdict.passed ? "PASS" : "FAIL"} ${slug}  ${(verdict.bytes / 1024).toFixed(1)} KB  ${sha256.slice(0, 12)}`);
  for (const rule of verdict.rules) {
    if (!rule.passed) console.log(`  ${rule.severity === "error" ? "FAIL" : "WARN"} ${rule.id}: ${rule.detail}`);
  }
  if (!verdict.passed) failed = true;

  entries.push({ meta, bytes: verdict.bytes, sha256, verdict, hasPoster: existsSync(poster) });
}

if (failed) {
  console.error("Site build stopped: at least one playable failed validation.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "play"), { recursive: true });
mkdirSync(join(dist, "posters"), { recursive: true });
cpSync(join(root, "site", "assets"), join(dist, "assets"), { recursive: true });

for (const entry of entries) {
  const slug = entry.meta.slug;
  cpSync(join(builtDir, slug, "index.html"), join(dist, "play", `${slug}.html`));
  if (entry.hasPoster) cpSync(join(gamesDir, slug, "poster.jpg"), join(dist, "posters", `${slug}.jpg`));
  mkdirSync(join(dist, slug), { recursive: true });
  writeFileSync(join(dist, slug, "index.html"), renderDetail(entry, info));
}

writeFileSync(join(dist, "index.html"), renderIndex(entries, info));
writeFileSync(
  join(dist, "manifest.json"),
  JSON.stringify(
    entries.map((entry) => ({
      slug: entry.meta.slug,
      title: entry.meta.title,
      bytes: entry.bytes,
      sha256: entry.sha256,
      passed: entry.verdict.passed,
    })),
    null,
    2,
  ) + "\n",
);

console.log(`Site written to dist/ with ${entries.length} playable${entries.length === 1 ? "" : "s"}.`);
