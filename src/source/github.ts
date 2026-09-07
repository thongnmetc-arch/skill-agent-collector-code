import { GitHubHttpError } from "../errors.ts";
import type { DiscoveredSkill, SkillSource } from "../types.ts";
import { claimSkillDirectories } from "./claim.ts";

const API_BASE = "https://api.github.com";

export interface GitHubApiClient {
  /** latest commit sha for owner/repo at ref (e.g. "HEAD" or a branch) */
  getCommitSha(owner: string, repo: string, ref: string): Promise<string>;
  /** every blob path in the repo tree at the given sha (recursive), "/" separated */
  getRecursiveTree(owner: string, repo: string, sha: string): Promise<string[]>;
  /** utf8 text of one file at the given sha */
  getFileText(owner: string, repo: string, sha: string, path: string): Promise<string>;
}

/**
 * Real GitHub REST client. Auth comes from the GITHUB_TOKEN env var only —
 * never hardcoded. Rate-limit responses surface as typed GitHubHttpError.
 */
export class GitHubHttpClient implements GitHubApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private token(): string | undefined {
    const token = process.env.GITHUB_TOKEN;
    return token && token.trim() !== "" ? token.trim() : undefined;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = this.token();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async json<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const reset = res.headers.get("x-ratelimit-reset");
      const detail = reset
        ? `rate limit reset at ${new Date(Number(reset) * 1000).toISOString()}`
        : (await this.errorSummary(res)).slice(0, 300);
      throw new GitHubHttpError(res.status, `GitHub ${res.status} for ${url}${detail ? ` — ${detail}` : ""}`);
    }
    return (await res.json()) as T;
  }

  private async errorSummary(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string };
      return body.message ?? "";
    } catch {
      return "";
    }
  }

  async getCommitSha(owner: string, repo: string, ref: string): Promise<string> {
    const data = await this.json<{ sha: string }>(
      `${this.baseUrl}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    );
    return data.sha;
  }

  async getRecursiveTree(owner: string, repo: string, sha: string): Promise<string[]> {
    const data = await this.json<{
      truncated: boolean;
      tree: { path?: string; type?: string }[];
    }>(`${this.baseUrl}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
    if (data.truncated) {
      throw new GitHubHttpError(413, `tree for ${owner}/${repo}@${sha} is truncated`);
    }
    return (data.tree ?? [])
      .filter((entry) => entry.type === "blob" && entry.path !== undefined)
      .map((entry) => entry.path as string);
  }

  async getFileText(owner: string, repo: string, sha: string, path: string): Promise<string> {
    const data = await this.json<{ content?: string; encoding?: string }>(
      `${this.baseUrl}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
    );
    if (data.encoding === "base64" && data.content !== undefined) {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    throw new GitHubHttpError(200, `unexpected contents payload for ${owner}/${repo}/${path}`);
  }
}

function treeUrl(owner: string, repo: string, sha: string, dir: string): string {
  const base = `https://github.com/${owner}/${repo}/tree/${sha}`;
  return dir === "" ? base : `${base}/${dir}`;
}

/**
 * Discover skills in one GitHub repo at a ref. The commit sha becomes the
 * record version; the source URL points at the skill dir in the tree.
 */
export async function discoverFromGitHub(
  api: GitHubApiClient,
  owner: string,
  repo: string,
  ref: string,
): Promise<DiscoveredSkill[]> {
  const sha = await api.getCommitSha(owner, repo, ref);
  const paths = await api.getRecursiveTree(owner, repo, sha);
  const claimed = claimSkillDirectories(paths);
  const discovered: DiscoveredSkill[] = [];
  for (const [dir, files] of claimed) {
    const contents = await Promise.all(
      files.map(async (file) => ({
        path: dir === "" ? file : file.slice(dir.length + 1),
        content: await api.getFileText(owner, repo, sha, file),
      })),
    );
    contents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    discovered.push({
      repo: `${owner}/${repo}`,
      dir,
      files: contents,
      sourceUrl: treeUrl(owner, repo, sha, dir),
      version: sha,
    });
  }
  discovered.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return discovered;
}

export class GitHubSkillSource implements SkillSource {
  readonly name = "github";

  private readonly api: GitHubApiClient;
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;

  constructor(api: GitHubApiClient, owner: string, repo: string, ref: string = "HEAD") {
    this.api = api;
    this.owner = owner;
    this.repo = repo;
    this.ref = ref;
  }

  discover(): Promise<DiscoveredSkill[]> {
    return discoverFromGitHub(this.api, this.owner, this.repo, this.ref);
  }
}
