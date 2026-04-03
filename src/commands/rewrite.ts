import { Command } from "commander";
import { resolve, relative } from "path";
import chalk from "chalk";
import ora from "ora";
import {
  scanFile,
  scanDirectory,
  rewriteFile,
  applyRewrite,
  groupResultsByFile,
  resolveKeysFromMessages,
  type ScanResult,
  type RewriteResult,
} from "@saidksi/localizer-core";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";
import { promptApplyChanges } from "../utils/prompt.js";
import { printDiff } from "../utils/diff.js";

// ─── Per-file rewrite flow ────────────────────────────────────────────────────

/**
 * Rewrite a single file:
 * 1. Show diff
 * 2. Ask for confirmation (unless --yes or --dry-run)
 * 3. Write to disk on confirmation
 *
 * Returns the RewriteResult (applied: true if written).
 */
async function processOneFile(
  filePath: string,
  results: ScanResult[],
  options: RewriteOptions,
  config: Awaited<ReturnType<typeof import("../utils/config.js").loadConfig>>,
): Promise<RewriteResult> {
  const cwd    = process.cwd();
  const relPath = relative(cwd, filePath);

  const rewrite = await rewriteFile(filePath, results, config);

  if (rewrite.changesCount === 0) {
    logger.dim(`${relPath} — no changes (all strings already translated or keys unresolved)`);
    return rewrite;
  }

  // Show file header + diff
  logger.blank();
  logger.raw(
    `  ${chalk.bold(chalk.cyan(relPath))}  ` +
    chalk.dim(`(${rewrite.changesCount} change${rewrite.changesCount !== 1 ? "s" : ""})`),
  );
  logger.blank();
  printDiff(rewrite.diff);
  logger.blank();

  if (options.dryRun) {
    logger.dim("  Dry run — skipping write.");
    return rewrite;
  }

  if (options.yes) {
    const applied = await applyRewrite(rewrite);
    logger.success(`Applied changes to ${relPath}`);
    return applied;
  }

  const confirmed = await promptApplyChanges(relPath);
  if (confirmed) {
    const applied = await applyRewrite(rewrite);
    logger.success(`Applied changes to ${relPath}`);
    return applied;
  }

  logger.warn(`Skipped ${relPath}`);
  return rewrite;
}

// ─── Command ──────────────────────────────────────────────────────────────────

interface RewriteOptions {
  file?: string;
  dir?: string;
  dryRun?: boolean;
  yes?: boolean;
}

async function runRewrite(options: RewriteOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  // ── Step 1: Scan
  const scanSpinner = ora("Scanning...").start();
  let rawResults: ScanResult[] = [];

  try {
    if (options.file) {
      rawResults = await scanFile(resolve(cwd, options.file), config);
    } else if (options.dir) {
      rawResults = await scanDirectory(resolve(cwd, options.dir), config);
    } else {
      const all = await Promise.all(
        config.include.map((d) =>
          scanDirectory(resolve(cwd, d), config).catch(() => [] as ScanResult[]),
        ),
      );
      rawResults = all.flat();
    }
  } catch (err: unknown) {
    scanSpinner.fail("Scan failed.");
    logger.fatal(err instanceof Error ? err.message : String(err));
  }

  scanSpinner.succeed(`Scanned ${new Set(rawResults.map((r) => r.file)).size} file(s).`);

  // ── Step 2: Resolve keys from messages JSON
  // (populated in memory when called from `run`; recovered from disk when standalone)
  const resolveSpinner = ora("Resolving keys from messages JSON...").start();
  const results = await resolveKeysFromMessages(rawResults, config);
  const resolvable = results.filter((r) => r.resolvedKey !== null && !r.alreadyTranslated);
  resolveSpinner.succeed(
    `${resolvable.length} string${resolvable.length !== 1 ? "s" : ""} ready to rewrite` +
    (results.length - resolvable.length > 0
      ? chalk.dim(` (${results.length - resolvable.length} skipped — no key found, run translate first)`)
      : ""),
  );

  if (resolvable.length === 0) {
    logger.blank();
    logger.info("Nothing to rewrite. Run `localizer translate` first to generate keys.");
    return;
  }

  // ── Step 3: Process file by file
  const byFile = groupResultsByFile(resolvable);
  const fileList = [...byFile.keys()];

  logger.blank();
  if (!options.yes && !options.dryRun) {
    logger.raw(chalk.dim(`  Processing ${fileList.length} file${fileList.length !== 1 ? "s" : ""} — you will be asked to confirm each diff.\n`));
  }

  let applied = 0;
  let skipped = 0;
  let totalChanges = 0;

  for (const [filePath, fileResults] of byFile) {
    const rewriteResult = await processOneFile(filePath, fileResults, options, config);
    if (rewriteResult.applied) {
      applied++;
      totalChanges += rewriteResult.changesCount;
    } else if (rewriteResult.changesCount > 0) {
      skipped++;
    }
  }

  // ── Summary
  logger.blank();
  if (options.dryRun) {
    logger.raw(chalk.bold("  Dry run summary:"));
    logger.dim(`  ${fileList.length} file${fileList.length !== 1 ? "s" : ""} would be rewritten.`);
  } else {
    logger.raw(chalk.bold("  Rewrite summary:"));
    if (applied > 0) {
      logger.success(`${applied} file${applied !== 1 ? "s" : ""} rewritten (${totalChanges} string${totalChanges !== 1 ? "s" : ""} replaced).`);
    }
    if (skipped > 0) {
      logger.warn(`${skipped} file${skipped !== 1 ? "s" : ""} skipped.`);
    }
  }
  logger.blank();
}

export const rewriteCommand = new Command("rewrite")
  .description("Replace hardcoded strings with t() calls (shows diff, confirms per file)")
  .option("--file <file>", "Scope to a single file")
  .option("--dir <dir>",   "Scope to a directory")
  .option("--dry-run",     "Preview diffs only, no writes")
  .option("--yes",         "Apply all changes without per-file confirmation")
  .action(async (options: RewriteOptions) => {
    try {
      await runRewrite(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
