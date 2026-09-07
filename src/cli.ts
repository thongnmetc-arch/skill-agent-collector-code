import { parseArgs } from "node:util";
import { runCollect, type CollectReport } from "./pipeline.ts";
import { runScheduler } from "./scheduler.ts";
import { DirectorySkillSource } from "./source/directory.ts";
import { GitHubHttpClient, GitHubSkillSource } from "./source/github.ts";
import { SQLiteSeenStore, type SeenStore } from "./store.ts";
import { CollectorError } from "./errors.ts";

const DEFAULT_DB = "data/seen.db";
const DEFAULT_OUT = "data/agent-update";

interface CliOptions {
  source: string;
  fixtureDir?: string;
  db?: string;
  out?: string;
  owner?: string;
  repo?: string;
  ref?: string;
  intervalHours?: number;
}

function parseCli(argv: string[]): { command: string; options: CliOptions } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      source: { type: "string", default: "github" },
      "fixture-dir": { type: "string" },
      db: { type: "string", default: DEFAULT_DB },
      out: { type: "string", default: DEFAULT_OUT },
      owner: { type: "string" },
      repo: { type: "string" },
      ref: { type: "string", default: "HEAD" },
      "interval-hours": { type: "string", default: "24" },
      help: { type: "boolean", default: false },
    },
  });
  const command = positionals[0] ?? "collect";
  const intervalHours = Number(values["interval-hours"]);
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new CollectorError("usage", `invalid --interval-hours: ${values["interval-hours"]}`);
  }
  return {
    command,
    options: {
      source: values.source,
      fixtureDir: values["fixture-dir"],
      db: values.db,
      out: values.out,
      owner: values.owner,
      repo: values.repo,
      ref: values.ref,
      intervalHours,
    },
  };
}

const HELP = `skill-agent-collector

Collect AI skills from GitHub (or a local fixture tree), normalize them into
skill records, detect new/updated skills by content hash, and emit an
agent-update artifact bundle (skills/<id>/<file> + manifest.json).

Usage:
  node src/cli.ts collect --source github --owner <owner> --repo <repo> [--ref HEAD]
  node src/cli.ts collect --source fixture --fixture-dir <dir>
  node src/cli.ts schedule --owner <owner> --repo <repo> [--interval-hours 24]
  node src/cli.ts --help

Options:
  --source github|fixture   source of skills (default github)
  --owner <owner>           GitHub owner (github source)
  --repo <repo>             GitHub repo (github source)
  --ref <ref>               branch/tag/sha (default HEAD)
  --fixture-dir <dir>       fixture tree root (fixture source)
  --db <path>               seen-store db (default data/seen.db)
  --out <dir>               agent-update output dir (default data/agent-update)
  --interval-hours <n>      schedule period (default 24)

GitHub access uses the GITHUB_TOKEN environment variable when present.
`;

function usageError(message: string): never {
  process.stderr.write(`error: ${message}\n\n${HELP}`);
  process.exit(2);
}

function makeSource(options: CliOptions) {
  if (options.source === "fixture") {
    if (!options.fixtureDir) {
      usageError("--source fixture requires --fixture-dir");
    }
    return new DirectorySkillSource(options.fixtureDir);
  }
  if (options.source !== "github") {
    usageError(`unknown --source: ${options.source}`);
  }
  if (!options.owner || !options.repo) {
    usageError("--source github requires --owner and --repo");
  }
  return new GitHubSkillSource(new GitHubHttpClient(), options.owner, options.repo, options.ref ?? "HEAD");
}

function printReport(report: CollectReport): void {
  const summary =
    `summary: discovered=${report.discovered}` +
    ` invalid=${report.invalid.length}` +
    ` new=${report.emitted.length}` +
    ` duplicate-in-batch=${report.duplicateInBatch.length}` +
    ` already-seen=${report.alreadySeen.length}` +
    (report.manifestPath ? ` manifest=${report.manifestPath}` : " manifest=none");
  process.stdout.write(`${summary}\n`);
  for (const item of report.invalid) {
    process.stdout.write(`invalid: dir=${item.dir} error=${item.error}\n`);
  }
  for (const skill of report.emitted) {
    process.stdout.write(`new-skill: id=${skill.id} hash=${skill.content_hash.slice(0, 12)} files=${skill.files.length}\n`);
  }
}

async function runCollectOnce(options: CliOptions): Promise<void> {
  const source = makeSource(options);
  const store: SeenStore = new SQLiteSeenStore(options.db ?? DEFAULT_DB);
  try {
    const report = await runCollect({
      discover: () => source.discover(),
      store,
      outDir: options.out ?? DEFAULT_OUT,
    });
    printReport(report);
  } finally {
    store.close();
  }
}

async function main(argv: string[]): Promise<void> {
  const { command, options } = parseCli(argv);
  if (options.source && argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (command === "schedule") {
    // makeSource validates the required flags up front
    makeSource(options);
    const controller = new AbortController();
    const onSignal = (): void => controller.abort();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    const intervalMs = (options.intervalHours ?? 24) * 3_600_000;
    const result = await runScheduler({
      runOnce: () => runCollectOnce(options),
      intervalMs,
      signal: controller.signal,
    });
    process.stdout.write(`schedule: finished after ${result.runs} run(s) (aborted=${result.aborted})\n`);
    return;
  }
  if (command === "collect") {
    await runCollectOnce(options);
    return;
  }
  usageError(`unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
});
