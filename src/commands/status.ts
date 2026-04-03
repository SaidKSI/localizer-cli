import { Command } from "commander";
import { join, resolve, relative } from "path";
import { stat } from "fs/promises";
import chalk from "chalk";
import ora from "ora";
import {
  validateCoverage,
  readCache,
  scanDirectory,
  type ValidationResult,
} from "@saidksi/localizer-core";
import { logger, progressBar } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)   return "just now";
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)    return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// ─── Command ──────────────────────────────────────────────────────────────────

interface StatusOptions {
  lang?: string;
}

async function runStatus(options: StatusOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  logger.header("Localizer project status");

  // ── Coverage
  const coverageSpinner = ora("Computing key coverage…").start();
  let results: ValidationResult[] = [];
  try {
    const validateOpts: import("@saidksi/localizer-core").ValidateOptions = {};
    if (options.lang !== undefined) validateOpts.lang = options.lang;
    results = await validateCoverage(config, validateOpts);
  } catch (err: unknown) {
    coverageSpinner.fail("Coverage check failed.");
    logger.fatal(err instanceof Error ? err.message : String(err));
  }
  coverageSpinner.succeed("Coverage computed.");

  logger.blank();
  logger.raw(chalk.bold("  Key coverage:\n"));
  for (const r of results) {
    console.log(progressBar(r.language, r.coveragePercent, r.totalKeys, r.missingKeys.length));
  }

  const incomplete = results.filter((r) => r.missingKeys.length > 0 && r.language !== config.defaultLanguage);
  if (incomplete.length > 0) {
    logger.blank();
    logger.dim(
      `  Run \`localizer translate --missing-only\` to fill ${incomplete.reduce((n, r) => n + r.missingKeys.length, 0)} missing key${incomplete.reduce((n, r) => n + r.missingKeys.length, 0) !== 1 ? "s" : ""}.`,
    );
  }

  // ── Scan summary (untranslated strings in source)
  logger.blank();
  const scanSpinner = ora("Scanning source files…").start();
  let untranslatedCount = 0;
  let untranslatedFiles = 0;

  try {
    const all = await Promise.all(
      config.include.map((d) =>
        scanDirectory(resolve(cwd, d), config).catch(() => []),
      ),
    );
    const flat = all.flat();
    const untranslated = flat.filter((r) => !r.alreadyTranslated);
    untranslatedCount = untranslated.length;
    untranslatedFiles = new Set(untranslated.map((r) => r.file)).size;
    scanSpinner.succeed(`Source scan complete.`);
  } catch {
    scanSpinner.fail("Source scan failed (skipping).");
  }

  logger.blank();
  logger.raw(chalk.bold("  Source scan:\n"));
  if (untranslatedCount > 0) {
    logger.raw(
      `  ${chalk.yellow(untranslatedCount)} untranslated string${untranslatedCount !== 1 ? "s" : ""} in ` +
      `${chalk.yellow(untranslatedFiles)} file${untranslatedFiles !== 1 ? "s" : ""}.`,
    );
    logger.dim(`  Run \`localizer translate\` to generate keys and translations.`);
  } else {
    logger.raw(`  ${chalk.green("✔")} All strings in source files are translated.`);
  }

  // ── Cache summary
  logger.blank();
  logger.raw(chalk.bold("  Cache:\n"));

  const cache = await readCache(cwd);
  const cachedEntries = Object.entries(cache.entries);

  if (cachedEntries.length === 0) {
    logger.dim("  No cache entries. Run `localizer run` to populate.");
  } else {
    const newest = cachedEntries.reduce<string | null>((latest, [, entry]) => {
      if (!latest) return entry.processedAt;
      return entry.processedAt > latest ? entry.processedAt : latest;
    }, null);

    const totalStrings = cachedEntries.reduce((n, [, e]) => n + e.stringCount, 0);

    logger.raw(`  ${chalk.cyan(cachedEntries.length)} file${cachedEntries.length !== 1 ? "s" : ""} cached · ${totalStrings} string${totalStrings !== 1 ? "s" : ""} processed.`);
    if (newest) {
      logger.dim(`  Last run: ${formatAge(newest)}`);
    }
    logger.dim(`  Cache path: ${relative(cwd, join(resolve(cwd), ".localizer", "cache.json"))}`);
  }

  // ── Config snapshot
  logger.blank();
  logger.raw(chalk.bold("  Config:\n"));
  logger.raw(`  Provider:   ${chalk.cyan(config.aiProvider)} (${config.aiModel})`);
  logger.raw(`  Languages:  ${chalk.cyan(config.defaultLanguage)} (default) + ${config.languages.filter((l) => l !== config.defaultLanguage).join(", ") || chalk.dim("none")}`);
  logger.raw(`  Messages:   ${config.messagesDir}`);
  logger.raw(`  Scan dirs:  ${config.include.join(", ")}`);
  if (config.strictMode) {
    logger.raw(`  Strict mode: ${chalk.yellow("on")}`);
  }
  logger.blank();

  // Check config file age
  try {
    const configStat = await stat(join(cwd, ".localizer", "config.json"));
    logger.dim(`  Config last modified: ${formatAge(configStat.mtime.toISOString())}`);
  } catch { /* config found elsewhere via cosmiconfig */ }

  logger.blank();
}

export const statusCommand = new Command("status")
  .description("Project health snapshot: coverage, last run, cost estimate")
  .option("--lang <lang>", "Focus on a single language")
  .action(async (options: StatusOptions) => {
    try {
      await runStatus(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
