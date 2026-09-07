import { SKILL_MARKDOWN_FILE } from "../normalize.ts";

export const SKILL_MARKDOWN_SUFFIX = `/${SKILL_MARKDOWN_FILE}`;

function posix(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function parentDirs(path: string): string[] {
  const parts = posix(path).split("/").filter((part) => part.length > 0);
  const dirs: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    dirs.push(parts.slice(0, i + 1).join("/"));
  }
  return dirs;
}

/**
 * Determine skill roots and assign every file to its owning skill root.
 *
 * A skill root is a directory that contains a SKILL.md and whose ancestors
 * contain NO SKILL.md ("outer skill wins"): a nested SKILL.md inside an
 * existing skill is a file of the outer skill, never its own skill.
 * The repo root itself (dir "") can be a skill root when it holds SKILL.md.
 *
 * Returns a Map of skill-root dir -> files under it (paths relative to the
 * scan root, "/" separated). Files not under any skill root are omitted.
 */
export function claimSkillDirectories(filePaths: string[]): Map<string, string[]> {
  const files = new Set<string>();
  for (const raw of filePaths) {
    const normalized = posix(raw);
    if (normalized.length > 0 && !normalized.endsWith("/")) {
      files.add(normalized);
    }
  }

  // candidate roots: every dir that directly contains a SKILL.md
  const candidates = new Set<string>();
  for (const file of files) {
    if (file === SKILL_MARKDOWN_FILE) {
      candidates.add("");
    } else if (file.endsWith(SKILL_MARKDOWN_SUFFIX)) {
      candidates.add(file.slice(0, -SKILL_MARKDOWN_SUFFIX.length));
    }
  }

  // keep only outer roots: drop any candidate that has a STRICT ancestor candidate
  const roots = new Set<string>();
  for (const candidate of candidates) {
    const ancestors = candidate === "" ? [] : parentDirs(candidate).filter((ancestor) => ancestor !== candidate);
    const shadowed = ancestors.some((ancestor) => candidates.has(ancestor));
    if (!shadowed) {
      roots.add(candidate);
    }
  }

  // assign each file to the deepest root that is an ancestor-or-self of it
  const claimed = new Map<string, string[]>();
  const sortedRoots = [...roots].sort((a, b) => b.split("/").length - a.split("/").length);
  for (const file of [...files].sort()) {
    for (const root of sortedRoots) {
      const under =
        root === "" || file === root || file.startsWith(root === "" ? "" : `${root}/`);
      if (under) {
        const list = claimed.get(root) ?? [];
        list.push(file);
        claimed.set(root, list);
        break;
      }
    }
  }
  return new Map([...claimed.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}
