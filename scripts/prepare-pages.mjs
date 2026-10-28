import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.resolve(root, "_site");
if (path.dirname(output) !== path.resolve(root)) throw new Error("Invalid Pages output directory");
try {
  if ((await fs.lstat(output)).isSymbolicLink()) throw new Error("Pages output must not be a symlink");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, "reports"), { recursive: true });
for (const file of ["index.html", "app.js", "styles.css", "data.json"]) {
  await fs.copyFile(path.join(root, file), path.join(output, file));
}
const start = (await fs.readFile(path.join(root, "public-data-start.txt"), "utf8")).trim();
for (const entry of await fs.readdir(path.join(root, "reports"), { withFileTypes: true })) {
  const date = entry.name.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (entry.isFile() && entry.name.endsWith(".md") && date && date >= start) {
    await fs.copyFile(path.join(root, "reports", entry.name), path.join(output, "reports", entry.name));
  }
}
await fs.writeFile(path.join(output, ".nojekyll"), "", "utf8");
console.log("Prepared Pages artifact from an explicit public-file allowlist.");
