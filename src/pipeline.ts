import { emitAgentUpdate } from "./emit.ts";
import { normalizeSkill } from "./normalize.ts";
import type { SeenStore } from "./store.ts";
import type { DiscoveredSkill, SkillRecord } from "./types.ts";

export interface CollectDeps {
  discover: () => Promise<DiscoveredSkill[]>;
  store: SeenStore;
  outDir: string;
}

export interface InvalidSkill {
  dir: string;
  error: string;
}

export interface CollectReport {
  discovered: number;
  invalid: InvalidSkill[];
  duplicateInBatch: SkillRecord[];
  alreadySeen: SkillRecord[];
  emitted: SkillRecord[];
  manifestPath?: string;
}

/**
 * One collection run: discover -> normalize -> same-batch dedupe by
 * content_hash -> store delta filter -> emit -> markSeenMany.
 *
 * Ordering invariant: skills are recorded as seen ONLY AFTER the artifact
 * emit succeeded. A crash before manifest.json => nothing marked => the
 * skills are retried on the next run.
 */
export async function runCollect(deps: CollectDeps): Promise<CollectReport> {
  const raw = await deps.discover();

  const invalid: InvalidSkill[] = [];
  const valid: SkillRecord[] = [];
  for (const discovered of raw) {
    const result = normalizeSkill(discovered);
    if (result.ok) {
      valid.push(result.skill);
    } else {
      invalid.push({ dir: discovered.dir, error: result.error });
    }
  }

  // same-batch dedupe by content hash: first occurrence wins
  const byHash = new Map<string, SkillRecord>();
  const duplicateInBatch: SkillRecord[] = [];
  for (const record of valid) {
    if (byHash.has(record.content_hash)) {
      duplicateInBatch.push(record);
    } else {
      byHash.set(record.content_hash, record);
    }
  }
  const unique = [...byHash.values()];

  // delta against the seen store
  const newOnes: SkillRecord[] = [];
  const alreadySeen: SkillRecord[] = [];
  for (const record of unique) {
    if (deps.store.has(record.content_hash)) {
      alreadySeen.push(record);
    } else {
      newOnes.push(record);
    }
  }

  const report: CollectReport = {
    discovered: raw.length,
    invalid,
    duplicateInBatch,
    alreadySeen,
    emitted: [],
  };

  if (newOnes.length === 0) {
    return report;
  }

  const result = await emitAgentUpdate(deps.outDir, newOnes);
  deps.store.markSeenMany(newOnes);
  report.emitted = newOnes;
  report.manifestPath = result.manifestPath;
  return report;
}
