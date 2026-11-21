/**
 * Serve dist/ locally. Usage: node scripts/serve.ts [port]
 * A tiny static server so the site can be checked before it is published.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const port = Number(process.argv[2] ?? 4174);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

createServer((request, response) => {
  const path = normalize(decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/"));
  let file = join(dist, path);
  if (!file.startsWith(dist)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
}).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}/`));
