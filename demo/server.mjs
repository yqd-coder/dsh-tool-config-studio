/**
 * Dependency-free static server for the standalone demo.
 *
 * Serves the project root so the demo page (demo/index.html) can import the
 * real plugin source from /src/... exactly as the DSH web client would.
 *
 * Usage:
 *   node demo/server.mjs            # http://localhost:4173/demo/
 *   PORT=8080 node demo/server.mjs  # custom port
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/demo/";

    // Resolve inside the project root and refuse traversal.
    const filePath = path.normalize(path.join(projectRoot, pathname));
    if (filePath !== projectRoot && !filePath.startsWith(projectRoot + path.sep)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }

    // Directory: try index.html, else 404.
    if (info.isDirectory()) {
      const indexFile = path.join(filePath, "index.html");
      try {
        const data = await readFile(indexFile);
        res.writeHead(200, { "content-type": contentType(indexFile) });
        res.end(data);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
      }
      return;
    }

    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(data);
  } catch (error) {
    console.error("[demo] request failed:", error.message);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal server error");
  }
});

server.listen(port, () => {
  console.log(`DSH Tool Config Studio demo running:`);
  console.log(`  http://localhost:${port}/demo/`);
  console.log("Press Ctrl+C to stop.");
});
