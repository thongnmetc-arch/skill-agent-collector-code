import { createHash } from "node:crypto";
import type { SkillFile } from "./types.ts";

/**
 * Deterministic content hash for a skill: sha256 over the file list
 * sorted by path, each entry encoded as `path \0 content \0`.
 * Byte-identical directories (same paths, same contents) yield the
 * same hash regardless of input order.
 */
export function hashSkillContent(files: SkillFile[]): string {
  const hash = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    hash.update(file.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(file.content, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}
