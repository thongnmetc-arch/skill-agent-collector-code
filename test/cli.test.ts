import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const WORKSPACE = fileURLToPath(new URL("../", import.meta.url));
const CLI = "src/cli.ts";
const FIXTURE = join(WORKSPACE, "test", "fixtures", "sources", "example-repo");

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: WORKSPACE,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("cli: fixture collect end-to-end twice (first run emits 3, second run sees 3 already-seen)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-e2e-"));
  try {
    const db = join(dir, "seen.db");
    const out = join(dir, "agent-update");

    const run1 = runCli(["collect", "--source", "fixture", "--fixture-dir", FIXTURE, "--db", db, "--out", out]);
    assert.equal(run1.status, 0, run1.stderr);
    assert.match(run1.stdout, /summary: discovered=4 invalid=0 new=3 duplicate-in-batch=1 already-seen=0/);
    assert.ok(existsSync(join(out, "manifest.json")));
    assert.ok(existsSync(join(out, "skills", "example-repo", "skills", "skill-docx", "SKILL.md")));

    const run2 = runCli(["collect", "--source", "fixture", "--fixture-dir", FIXTURE, "--db", db, "--out", out]);
    assert.equal(run2.status, 0, run2.stderr);
    assert.match(run2.stdout, /summary: discovered=4 invalid=0 new=0 duplicate-in-batch=1 already-seen=3 manifest=none/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: missing --fixture-dir exits nonzero (usage error)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-usage-"));
  try {
    const result = runCli(["collect", "--source", "fixture", "--db", join(dir, "seen.db")]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires --fixture-dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: unknown command exits 2", () => {
  const result = runCli(["frobnicate"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});
