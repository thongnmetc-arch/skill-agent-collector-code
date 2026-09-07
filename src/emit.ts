import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { CollectorError } from "./errors.ts";
import type { SkillFile, SkillRecord } from "./types.ts";

export interface EmitResult {
  manifestPath: string;
  fileCount: number;
  skillCount: number;
}

const SCHEMA_VERSION = 1;

function checkId(id: string): void {
  if (id === "" || id.includes("..") || id.startsWith("/") || id.includes("\\")) {
    throw new CollectorError("invalid_skill_id", `skill id is not filesystem-safe: ${JSON.stringify(id)}`);
  }
}

/**
 * Write one skill bundle under outDir/skills/<id>/<file> and finish with
 * manifest.json written LAST (so a crash before the manifest leaves nothing
 * recorded as seen and the run is retried next time). Duplicate id with a
 * different content hash fails closed.
 */
export async function emitAgentUpdate(outDir: string, records: SkillRecord[]): Promise<EmitResult> {
  const byId = new Map<string, SkillRecord>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (existing && existing.content_hash !== record.content_hash) {
      throw new CollectorError(
        "duplicate_skill_id",
        `two different skills claim id ${record.id} (hash ${existing.content_hash} vs ${record.content_hash})`,
      );
    }
    byId.set(record.id, record);
  }

  const outResolved = resolve(outDir);
  const writeOne = async (file: SkillFile, id: string): Promise<void> => {
    const target = resolve(join(outResolved, "skills", id, file.path));
    const prefix = join(outResolved, "skills", id) + sep;
    if (!target.startsWith(prefix)) {
      throw new CollectorError("path_escape", `file path escapes skill bundle: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  };

  let fileCount = 0;
  for (const record of records) {
    checkId(record.id);
    for (const file of record.files) {
      await writeOne(file, record.id);
      fileCount += 1;
    }
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    count: records.length,
    skills: records.map((record) => ({
      id: record.id,
      name: record.name,
      description: record.description,
      source_url: record.source_url,
      version: record.version ?? null,
      content_hash: record.content_hash,
      files: record.files.map((file) => file.path),
      metadata: record.metadata,
    })),
  };
  const manifestPath = join(outResolved, "manifest.json");
  await mkdir(outResolved, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return { manifestPath, fileCount, skillCount: records.length };
}
