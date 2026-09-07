import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DirectorySkillSource } from "../src/source/directory.ts";
import { discoverFromGitHub, type GitHubApiClient } from "../src/source/github.ts";
import { normalizeSkill, slugifySkillId } from "../src/normalize.ts";
import { runCollect } from "../src/pipeline.ts";
import { SQLiteSeenStore } from "../src/store.ts";
import type { DiscoveredSkill } from "../src/types.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/sources/example-repo", import.meta.url));

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("AC-1: directory discovery finds 4 skills, outer-wins, ignores non-skill files", async () => {
  const source = new DirectorySkillSource(FIXTURE);
  const skills = await source.discover();
  assert.equal(skills.length, 4);
  assert.deepEqual(
    skills.map((s) => s.dir),
    ["skills/skill-docx", "skills/skill-dup-a", "skills/skill-dup-b", "skills/skill-web-research"],
  );
  // nested SKILL.md under skill-docx/templates is NOT its own skill
  assert.ok(!skills.some((s) => s.dir === "skills/skill-docx/templates"));
  // README.md at repo root is not under any skill root => ignored
  assert.ok(!skills.some((s) => s.files.some((f) => f.path === "README.md")));
  // skill-docx claims 3 files incl. the nested template
  const docx = skills.find((s) => s.dir === "skills/skill-docx");
  assert.ok(docx);
  assert.deepEqual(
    docx.files.map((f) => f.path),
    ["SKILL.md", "reference/format-notes.md", "templates/SKILL.md"],
  );
  assert.equal(docx.sourceUrl, "file:///" + join(FIXTURE, "skills", "skill-docx").replace(/\\/g, "/"));
});

test("AC-2: normalize yields valid records; quoted description stripped; hash stable", async () => {
  const source = new DirectorySkillSource(FIXTURE);
  const skills = await source.discover();

  const docx = skills.find((s) => s.dir === "skills/skill-docx");
  assert.ok(docx);
  const result = normalizeSkill(docx);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.skill.id, "example-repo/skills/skill-docx");
  assert.equal(result.skill.name, "skill-docx");
  assert.equal(result.skill.description, "Create and edit .docx documents with precision"); // quotes stripped
  assert.equal(result.skill.metadata.file_count, 3);
  assert.match(result.skill.content_hash, /^[0-9a-f]{64}$/);

  // hash stability: reordering files must not change the hash
  const shuffled = { ...docx, files: [...docx.files].reverse() };
  const again = normalizeSkill(shuffled);
  assert.ok(again.ok);
  if (again.ok) assert.equal(again.skill.content_hash, result.skill.content_hash);

  // byte-identical duplicate dirs share the same content hash
  const dupA = skills.find((s) => s.dir === "skills/skill-dup-a");
  const dupB = skills.find((s) => s.dir === "skills/skill-dup-b");
  assert.ok(dupA && dupB);
  const a = normalizeSkill(dupA);
  const b = normalizeSkill(dupB);
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.equal(a.skill.content_hash, b.skill.content_hash);
});

test("AC-2b: normalize rejects missing description; name falls back to folder", () => {
  const makeRaw = (dir: string, frontmatter: string): DiscoveredSkill => ({
    repo: "example-repo",
    dir,
    files: [{ path: "SKILL.md", content: `---\n${frontmatter}---\n# body\n` }],
  });
  const missingDescription = normalizeSkill(makeRaw("skills/some-skill", "name: some-skill\n"));
  assert.equal(missingDescription.ok, false);
  if (!missingDescription.ok) assert.match(missingDescription.error, /missing a description/);

  const noName = normalizeSkill(makeRaw("skills/no-name", "description: Only a description\n"));
  assert.ok(noName.ok);
  if (noName.ok) assert.equal(noName.skill.name, "no-name");
  assert.equal(slugifySkillId("Owner Org/My.Repo", "skills/a b"), "owner-org-my-repo/skills/a-b");
});

test("AC-3: e2e runCollect dedupes in batch and across runs via SQLite", async () => {
  const dir = tempDir("collect-e2e-");
  const db = join(dir, "seen.db");
  const out = join(dir, "agent-update");
  let store1: SQLiteSeenStore | undefined;
  let store2: SQLiteSeenStore | undefined;
  try {
    const source = new DirectorySkillSource(FIXTURE);
    store1 = new SQLiteSeenStore(db);
    const run1 = await runCollect({ discover: () => source.discover(), store: store1, outDir: out });
    assert.equal(run1.discovered, 4);
    assert.equal(run1.invalid.length, 0);
    assert.equal(run1.emitted.length, 3); // dup-a & dup-b collapse to one
    assert.equal(run1.duplicateInBatch.length, 1);
    assert.equal(run1.alreadySeen.length, 0);
    assert.ok(run1.manifestPath);
    assert.equal(store1.count(), 3);
    store1.close();
    store1 = undefined;

    // second run against the SAME db: nothing new
    store2 = new SQLiteSeenStore(db);
    const run2 = await runCollect({ discover: () => source.discover(), store: store2, outDir: out });
    assert.equal(run2.emitted.length, 0);
    assert.equal(run2.duplicateInBatch.length, 1);
    assert.equal(run2.alreadySeen.length, 3);
    assert.equal(run2.manifestPath, undefined); // nothing new => no rewrite
    assert.equal(store2.count(), 3);
    store2.close();
    store2 = undefined;
  } finally {
    try {
      store1?.close();
    } catch {
      /* already closed */
    }
    try {
      store2?.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("AC-4: emit writes bundles + manifest; only one dup dir survives", async () => {
  const dir = tempDir("collect-emit-");
  const out = join(dir, "agent-update");
  try {
    const source = new DirectorySkillSource(FIXTURE);
    const store = new SQLiteSeenStore(":memory:");
    const report = await runCollect({ discover: () => source.discover(), store, outDir: out });
    store.close();

    assert.ok(report.manifestPath);
    const manifest = JSON.parse(readFileSync(report.manifestPath, "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.count, 3);
    assert.equal(typeof manifest.generatedAt, "string");
    const ids = manifest.skills.map((s: { id: string }) => s.id);
    assert.deepEqual(ids, [
      "example-repo/skills/skill-docx",
      "example-repo/skills/skill-dup-a",
      "example-repo/skills/skill-web-research",
    ]);

    // bundle files land on disk with original content
    const fixtureDocx = readFileSync(join(FIXTURE, "skills", "skill-docx", "SKILL.md"), "utf8");
    const emittedDocx = readFileSync(join(out, "skills", "example-repo", "skills", "skill-docx", "SKILL.md"), "utf8");
    assert.equal(emittedDocx, fixtureDocx);
    // nested file is emitted under the OUTER skill id
    const nested = readFileSync(
      join(out, "skills", "example-repo", "skills", "skill-docx", "templates", "SKILL.md"),
      "utf8",
    );
    assert.ok(nested.includes("nested SKILL.md inside an existing skill root"));
    // only ONE of the duplicate pair has a bundle dir
    assert.ok(existsSync(join(out, "skills", "example-repo", "skills", "skill-dup-a", "SKILL.md")));
    assert.ok(!existsSync(join(out, "skills", "example-repo", "skills", "skill-dup-b")));
    // manifest skills reference file paths (no inline content)
    const docxManifest = manifest.skills.find((s: { id: string }) => s.id === "example-repo/skills/skill-docx");
    assert.equal(docxManifest.files.length, 3);
    assert.deepEqual(docxManifest.files, ["SKILL.md", "reference/format-notes.md", "templates/SKILL.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("offline GitHub discovery: fake API, nested SKILL.md belongs to outer, version=sha", async () => {
  class FakeGitHubApi implements GitHubApiClient {
    private readonly contents: Map<string, string>;
    constructor() {
      this.contents = new Map([
        ["skills/alpha/SKILL.md", "---\nname: alpha\ndescription: Alpha skill\n---\nAlpha body\n"],
        ["skills/alpha/helper.md", "helper for alpha"],
        ["skills/alpha/inner/SKILL.md", "---\nname: inner\ndescription: Inner file\n---\ninner\n"],
        ["skills/beta/SKILL.md", "---\nname: beta\ndescription: Beta skill\n---\nBeta body\n"],
        ["README.md", "# repo readme"],
      ]);
    }
    async getCommitSha(): Promise<string> {
      return "0123456789abcdef";
    }
    async getRecursiveTree(): Promise<string[]> {
      return [...this.contents.keys()];
    }
    async getFileText(_o: string, _r: string, _sha: string, path: string): Promise<string> {
      const text = this.contents.get(path);
      if (text === undefined) throw new Error(`no fake content for ${path}`);
      return text;
    }
  }

  const discovered = await discoverFromGitHub(new FakeGitHubApi(), "octo", "skills-repo", "main");
  assert.equal(discovered.length, 2);
  const alpha = discovered.find((s) => s.dir === "skills/alpha");
  const beta = discovered.find((s) => s.dir === "skills/beta");
  assert.ok(alpha && beta);
  assert.deepEqual(
    alpha.files.map((f) => f.path),
    ["SKILL.md", "helper.md", "inner/SKILL.md"],
  );
  assert.deepEqual(beta.files.map((f) => f.path), ["SKILL.md"]);
  assert.equal(alpha.version, "0123456789abcdef");
  assert.equal(alpha.sourceUrl, "https://github.com/octo/skills-repo/tree/0123456789abcdef/skills/alpha");

  const normalized = normalizeSkill(alpha);
  assert.ok(normalized.ok);
  if (normalized.ok) {
    assert.equal(normalized.skill.version, "0123456789abcdef");
    assert.equal(normalized.skill.files.length, 3);
  }
});
