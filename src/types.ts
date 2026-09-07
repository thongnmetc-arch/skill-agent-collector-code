/**
 * Core domain types for the Skill Agent Collector (M-001).
 * All file paths inside skill bundles use "/" separators and are
 * relative to the skill root directory.
 */

export interface SkillFile {
  /** path relative to the skill root, "/" separated (e.g. "SKILL.md", "templates/SKILL.md") */
  path: string;
  /** utf8 file content */
  content: string;
}

export interface DiscoveredSkill {
  /** repository / scan-root name (e.g. "example-repo" or "owner/repo") */
  repo: string;
  /** skill root directory relative to the repo/scan root; "" means repo root */
  dir: string;
  files: SkillFile[];
  /** canonical source URL of the skill directory (file:// for fixtures, github tree URL otherwise) */
  sourceUrl?: string;
  /** upstream version if the source provides one (e.g. commit sha for GitHub) */
  version?: string;
}

export interface SkillRecord {
  /** slug of repo + "/" + dir (filesystem-safe) */
  id: string;
  name: string;
  description: string;
  source_url: string;
  version?: string;
  /** sha256 hex over the sorted (path, content) pairs of files */
  content_hash: string;
  files: SkillFile[];
  metadata: Record<string, string | number>;
}

export interface SkillSource {
  readonly name: string;
  discover(): Promise<DiscoveredSkill[]>;
}
