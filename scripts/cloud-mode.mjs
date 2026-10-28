import { readFileSync } from "node:fs";
import path from "node:path";

export function cloudEnabled(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, "cloud-monitor.json"), "utf8")).enabled === true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function requireLocalPublisher(root) {
  if (cloudEnabled(root)) throw new Error("Cloud monitoring is active. Run node scripts/sync-from-cloud.mjs; do not overwrite cloud records with local data.");
}
