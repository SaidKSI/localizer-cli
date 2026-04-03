import { Command } from "commander";
import { basename, extname } from "path";
import ora from "ora";
import chalk from "chalk";
import { validateCoverage, type ValidationResult } from "@saidksi/localizer-core";
import { logger, progressBar } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";

// ─── Output ───────────────────────────────────────────────────────────────────

const MISSING_PREVIEW = 10;

function printCoverageTable(results: ValidationResult[]): void {
  logger.blank();
  logger.raw(chalk.bold("  Key coverage report:\n"));

  for (const r of results) {
    console.log(progressBar(r.language, r.coveragePercent, r.totalKeys, r.missingKeys.length));
  }

  logger.blank();
}

function printMissingKeys(results: ValidationResult[]): void {
  const incomplete = results.filter((r) => r.missingKeys.length > 0);
  if (incomplete.length === 0) return;

  for (const r of incomplete) {
    const total   = r.missingKeys.length;
    const preview = r.missingKeys.slice(0, MISSING_PREVIEW);
    const more    = total - preview.length;

    logger.raw(
      `  ${chalk.bold(`Missing keys in ${chalk.red(r.language)}`)} ` +
      chalk.dim(`(${total > MISSING_PREVIEW ? `first ${MISSING_PREVIEW} of ` : ""}${total}):`),
    );

    for (const key of preview) {
      logger.raw(`    ${chalk.dim("·")} ${key}`);
    }

    if (more > 0) {
      logger.dim(`    … and ${more} more`);
    }

    logger.blank();
  }
}

function printNextSteps(results: ValidationResult[], config: import("@saidksi/localizer-core").LocalizerConfig, lang?: string): void {
  const incomplete = results.filter(
    (r) => r.missingKeys.length > 0 && r.language !== config.defaultLanguage,
  );
  if (incomplete.length === 0) return;

  const langFlag = lang ? ` --lang ${lang}` : "";
  logger.raw(
    chalk.dim(
      `  Run \`localizer translate --missing-only${langFlag}\` to fill missing keys.`,
    ),
  );
  logger.blank();
}

// ─── CI output ────────────────────────────────────────────────────────────────

/**
 * Machine-readable output for CI environments.
 * Prints a JSON summary to stdout.
 */
function printCiOutput(results: ValidationResult[]): void {
  const output = results.map((r) => ({
    language:       r.language,
    coveragePercent: r.coveragePercent,
    totalKeys:      r.totalKeys,
    missingCount:   r.missingKeys.length,
    missingKeys:    r.missingKeys,
  }));
  console.log(JSON.stringify(output, null, 2));
}

// ─── Command ──────────────────────────────────────────────────────────────────

interface ValidateOptions {
  lang?: string;
  file?: string;
  ci?: boolean;
}

async function runValidate(options: ValidateOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  // Derive page name from --file if provided.
  // Source file path maps directly to its per-page JSON:
  //   src/pages/Login.tsx  →  messages/{lang}/login.json
  //   app/checkout.tsx     →  messages/{lang}/checkout.json
  const page = options.file
    ? basename(options.file, extname(options.file)).toLowerCase()
    : undefined;

  if (page) {
    const langs = options.lang ? [options.lang] : config.languages;
    const files = langs.map((l) => `${config.messagesDir}/${l}/${page}.json`).join(", ");
    logger.dim(`  Scoped to page: ${chalk.cyan(`${page}.json`)} (${files})`);
    logger.blank();
  }

  const spinner = ora("Checking key coverage...").start();

  let results: ValidationResult[] = [];
  try {
    const validateOpts: import("@saidksi/localizer-core").ValidateOptions = {};
    if (options.lang !== undefined) validateOpts.lang = options.lang;
    if (page !== undefined) validateOpts.page = page;
    results = await validateCoverage(config, validateOpts);
  } catch (err: unknown) {
    spinner.fail("Validation failed.");
    logger.fatal(err instanceof Error ? err.message : String(err));
  }

  const totalMissing = results.reduce((n, r) => n + r.missingKeys.length, 0);
  const allCovered   = totalMissing === 0;

  spinner.succeed(
    allCovered
      ? "All keys present across all languages."
      : `${totalMissing} missing key${totalMissing !== 1 ? "s" : ""} found.`,
  );

  if (options.ci) {
    printCiOutput(results);
  } else {
    printCoverageTable(results);
    printMissingKeys(results);
    printNextSteps(results, config, options.lang);
  }

  // Exit 1 in CI mode or strict mode when keys are missing
  if (!allCovered && (options.ci || config.strictMode)) {
    process.exit(1);
  }
}

export const validateCommand = new Command("validate")
  .description("Check key coverage across all language JSON files")
  .option("--lang <lang>",  "Check a single language only")
  .option("--file <file>",  "Scope to keys from one source file (by page name)")
  .option("--ci",           "Machine-readable JSON output, exit 1 on any missing keys")
  .action(async (options: ValidateOptions) => {
    try {
      await runValidate(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
