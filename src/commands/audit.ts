import { Command } from "commander";
import { resolve, relative, dirname, basename } from "path";
import ora from "ora";
import chalk from "chalk";
import { scanFile, scanDirectory, type ScanResult } from "@saidksi/localizer-core";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";
import { writeReport } from "../utils/reporter.js";

// ─── Grouping ─────────────────────────────────────────────────────────────────

interface GroupEntry {
  label: string;
  stringCount: number;
  fileCount: number;
  files: string[];
}

/**
 * Group scan results by relative directory path.
 * e.g. all results from "src/pages/Login.tsx" and "src/pages/Register.tsx"
 * → one group labelled "src/pages/"
 */
function groupByDirectory(
  results: ScanResult[],
  cwd: string,
): GroupEntry[] {
  const map = new Map<string, { files: Set<string>; count: number }>();

  for (const r of results) {
    const rel = relative(cwd, r.file);
    const dir = dirname(rel) + "/";
    const entry = map.get(dir) ?? { files: new Set(), count: 0 };
    entry.files.add(r.file);
    entry.count++;
    map.set(dir, entry);
  }

  return [...map.entries()]
    .map(([label, { files, count }]) => ({
      label,
      stringCount: count,
      fileCount: files.size,
      files: [...files],
    }))
    .sort((a, b) => b.stringCount - a.stringCount);
}

/**
 * Group scan results by source file (page name).
 * e.g. all results from "src/pages/Login.tsx" → one group labelled "Login.tsx"
 */
function groupByPage(
  results: ScanResult[],
  cwd: string,
): GroupEntry[] {
  const map = new Map<string, { file: string; count: number }>();

  for (const r of results) {
    const rel  = relative(cwd, r.file);
    const page = basename(r.file);
    const entry = map.get(rel) ?? { file: rel, count: 0 };
    entry.count++;
    map.set(rel, entry);
  }

  return [...map.entries()]
    .map(([rel, { count }]) => ({
      label: rel,
      stringCount: count,
      fileCount: 1,
      files: [rel],
    }))
    .sort((a, b) => b.stringCount - a.stringCount);
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printAuditTable(groups: GroupEntry[], total: ScanResult[], cwd: string): void {
  if (total.length === 0) {
    logger.success("No untranslated strings found.");
    return;
  }

  logger.blank();
  logger.raw(chalk.bold("  Untranslated strings found:\n"));

  // Calculate column widths for alignment
  const maxLabelLen = Math.max(...groups.map((g) => g.label.length), 10);

  for (const g of groups) {
    const label      = g.label.padEnd(maxLabelLen + 2);
    const strCount   = chalk.yellow(`${g.stringCount} string${g.stringCount !== 1 ? "s" : ""}`);
    const fileCount  = chalk.dim(`across ${g.fileCount} file${g.fileCount !== 1 ? "s" : ""}`);
    logger.raw(`  ${chalk.cyan(label)}  ${strCount}  ${fileCount}`);
  }

  const totalFiles = new Set(total.map((r) => r.file)).size;
  logger.blank();
  logger.raw(
    `  ${chalk.bold("Total:")} ${chalk.yellow(total.length)} strings in ${chalk.yellow(totalFiles)} files`,
  );
  logger.blank();
  logger.raw(chalk.dim("  Run `localizer run --dir <path>` to process any directory."));
  logger.raw(chalk.dim("  Run `localizer audit --output audit.json` to export as a work list."));
  logger.blank();
}

function printSummaryOnly(groups: GroupEntry[], total: ScanResult[]): void {
  if (total.length === 0) {
    logger.success("No untranslated strings found.");
    return;
  }
  for (const g of groups) {
    logger.raw(`  ${g.label.padEnd(40)}  ${g.stringCount}`);
  }
  const totalFiles = new Set(total.map((r) => r.file)).size;
  logger.blank();
  logger.raw(`  Total: ${total.length} strings in ${totalFiles} files`);
}

// ─── Command ──────────────────────────────────────────────────────────────────

interface AuditOptions {
  dir?: string;
  file?: string;
  summary?: boolean;
  output?: string;
  groupBy?: string;
  ci?: boolean;
}

async function runAudit(options: AuditOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  const spinner = ora("Scanning for untranslated strings...").start();

  let results: ScanResult[] = [];

  try {
    if (options.file) {
      results = await scanFile(resolve(cwd, options.file), config);
    } else if (options.dir) {
      results = await scanDirectory(resolve(cwd, options.dir), config);
    } else {
      // Scan all include dirs from config
      const all = await Promise.all(
        config.include.map((dir) =>
          scanDirectory(resolve(cwd, dir), config).catch(() => [] as ScanResult[]),
        ),
      );
      results = all.flat();
    }
  } catch (err: unknown) {
    spinner.fail("Scan failed.");
    logger.fatal(err instanceof Error ? err.message : String(err));
  }

  // Filter already-translated strings — audit only shows untranslated ones
  const untranslated = results.filter((r) => !r.alreadyTranslated);

  spinner.succeed(
    `Scanned ${new Set(results.map((r) => r.file)).size} files — ` +
    `${untranslated.length} untranslated string${untranslated.length !== 1 ? "s" : ""} found.`,
  );

  // Group results
  const groupFn = options.groupBy === "page" ? groupByPage : groupByDirectory;
  const groups  = groupFn(untranslated, cwd);

  // CI mode: output JSON to stdout and exit with code 1 if issues found
  if (options.ci) {
    const reportData = {
      generatedAt: new Date().toISOString(),
      file: options.file,
      dir: options.dir,
      totalStrings: untranslated.length,
      totalFiles: new Set(untranslated.map((r) => r.file)).size,
      groups,
      results: untranslated,
    };
    console.log(JSON.stringify(reportData, null, 2));
    if (untranslated.length > 0) {
      process.exit(1);
    }
    return;
  }

  // Print output
  if (options.summary) {
    printSummaryOnly(groups, untranslated);
  } else {
    printAuditTable(groups, untranslated, cwd);
  }

  // Write JSON report if requested
  if (options.output) {
    await writeReport(options.output, {
      generatedAt: new Date().toISOString(),
      file: options.file,
      dir: options.dir,
      totalStrings: untranslated.length,
      totalFiles: new Set(untranslated.map((r) => r.file)).size,
      groups,
      results: untranslated,
    });
    logger.success(`Report written to ${options.output}`);
  }
}

export const auditCommand = new Command("audit")
  .description("Scan the full app for untranslated strings (read-only, no AI)")
  .option("--dir <dir>",      "Scope to a directory")
  .option("--file <file>",    "Scope to a single file")
  .option("--summary",        "Print counts per directory only")
  .option("--output <path>",  "Export structured report as JSON")
  .option("--group-by <by>",  "Group results by: page")
  .option("--ci",             "Machine-readable JSON output to stdout, exit 1 if any strings found")
  .action(async (options: AuditOptions) => {
    try {
      await runAudit(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
