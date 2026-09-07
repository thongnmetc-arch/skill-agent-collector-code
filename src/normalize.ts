import { hashSkillContent } from "./hash.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import type { DiscoveredSkill, SkillFile, SkillRecord } from "./types.ts";

export const SKILL_MARKDOWN_FILE = "SKILL.md";

export interface NormalizeOk {
  ok: true;
  skill: SkillRecord;
}

export interface NormalizeError {
  ok: false;
  error: string;
}

export type NormalizeResult = NormalizeOk | NormalizeError;

function slugSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Filesystem-safe skill id: a slug of the repo joined with the skill dir.
 * e.g. repo "example-repo", dir "skills/skill-docx" => "example-repo/skills/skill-docx".
 */
export function slugifySkillId(repo: string, dir: string): string {
  const repoSlug = slugSegment(repo);
  const dirSlug =
    dir === ""
      ? ""
      : dir
          .split("/")
          .filter((part) => part.length > 0)
          .map(slugSegment)
          .filter((part) => part.length > 0)
          .join("/");
  return dirSlug === "" ? repoSlug : `${repoSlug}/${dirSlug}`;
}

function sortFiles(files: SkillFile[]): SkillFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function folderNameOf(raw: DiscoveredSkill): string {
  if (raw.dir !== "") {
    const parts = raw.dir.split("/").filter((part) => part.length > 0);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const repoParts = raw.repo.split("/").filter((part) => part.length > 0);
  return repoParts.length > 0 ? repoParts[repoParts.length - 1] : raw.repo;
}

/**
 * Normalize a discovered skill into a validated SkillRecord.
 * - name: frontmatter `name`, falling back to the folder name of `dir`
 * - description: frontmatter `description` (required — missing => invalid)
 * - version: source version ?? frontmatter `version`
 */
export function normalizeSkill(raw: DiscoveredSkill): NormalizeResult {
  const sorted = sortFiles(raw.files);
  const markdown = sorted.find((f) => f.path === SKILL_MARKDOWN_FILE);
  if (!markdown) {
    return { ok: false, error: `no ${SKILL_MARKDOWN_FILE} in claimed files` };
  }
  const fm = parseFrontmatter(markdown.content);
  const name = fm?.values["name"]?.trim() || folderNameOf(raw);
  const description = fm?.values["description"]?.trim() ?? "";
  if (!description) {
    return { ok: false, error: `skill ${raw.dir === "" ? raw.repo : raw.dir} is missing a description` };
  }
  const contentHash = hashSkillContent(sorted);
  const sourceVersion = raw.version !== undefined && raw.version !== "" ? raw.version : undefined;
  const frontmatterVersion = fm?.values["version"]?.trim() || undefined;
  const version = sourceVersion ?? frontmatterVersion;
  const skill: SkillRecord = {
    id: slugifySkillId(raw.repo, raw.dir),
    name,
    description,
    source_url: raw.sourceUrl ?? "",
    ...(version !== undefined ? { version } : {}),
    content_hash: contentHash,
    files: sorted,
    metadata: { format: "skill-md", file_count: sorted.length },
  };
  return { ok: true, skill };
}
