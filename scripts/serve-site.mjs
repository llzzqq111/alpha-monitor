import { createServer } from "node:http";
import { promises as fs, watch } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const siteDir = path.join(root, "site");
const port = Number(process.env.PORT || 8787);

let building = false;
let pending = false;

function build() {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  const child = spawn(process.execPath, ["scripts/build-site.mjs"], { cwd: root, stdio: "inherit" });
  child.on("exit", () => {
    building = false;
    if (pending) {
      pending = false;
      build();
    }
  });
}

for (const dir of ["snapshots", "reports"]) {
  try {
    watch(path.join(root, dir), { recursive: false }, build);
  } catch {}
}
try {
  watch(path.join(root, "telegram_project_counts.csv"), build);
} catch {}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(siteDir, pathname));
  if (!file.startsWith(siteDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.on("error", (error) => {
  console.error(`Server failed on port ${port}: ${error.message}`);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  build();
  console.log(`Alpha dashboard: http://127.0.0.1:${port}`);
});
