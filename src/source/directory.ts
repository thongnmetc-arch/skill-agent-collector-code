import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { DiscoveredSkill, SkillFile, SkillSource } from "../types.ts";
import { claimSkillDirectories } from "./claim.ts";

const SKIP_DIRS = new Set([".git", "node_modules"]);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await walk(root, rel, out);
      }
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

/**
 * Deterministic local/offline source: recursively scans a fixture directory
 * tree for skill roots (dirs containing SKILL.md) and reads their files.
 * No network access.
 */
export class DirectorySkillSource implements SkillSource {
  readonly name = "fixture";
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async discover(): Promise<DiscoveredSkill[]> {
    const allFiles: string[] = [];
    await walk(this.rootDir, "", allFiles);
    const claimed = claimSkillDirectories(allFiles);
    const skills: DiscoveredSkill[] = [];
    for (const [dir, files] of claimed) {
      const skillFiles: SkillFile[] = [];
      for (const file of files) {
        const content = await readFile(join(this.rootDir, file), "utf8");
        const pathInSkill =
          dir === "" ? file : relative(dir, file).replace(/\\/g, "/");
        skillFiles.push({ path: pathInSkill, content });
      }
      skillFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const skillDirAbs = dir === "" ? this.rootDir : join(this.rootDir, dir);
      skills.push({
        repo: basename(this.rootDir),
        dir,
        files: skillFiles,
        sourceUrl: pathToFileURL(skillDirAbs).href,
      });
    }
    skills.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
    return skills;
  }
}
