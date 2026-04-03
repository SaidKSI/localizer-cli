import { Command } from "commander";
import { writeFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { validateCoverage } from "@saidksi/localizer-core";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";

// ─── Command ──────────────────────────────────────────────────────────────────

interface DiffOptions {
  lang: string;
  output?: string;
}

async function runDiff(options: DiffOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  const lang = options.lang.trim().toLowerCase();

  // Validate: must be a known language
  const known = [config.defaultLanguage, ...config.languages];
  if (!known.includes(lang)) {
    logger.fatal(
      `Language "${lang}" is not in your config. Known languages: ${known.join(", ")}`,
    );
  }

  if (lang === config.defaultLanguage) {
    logger.warn(`"${lang}" is the default language — it always has 100% coverage.`);
    return;
  }

  const spinner = ora(`Computing diff for "${lang}"…`).start();
  // Single validateCoverage call provides both missing keys and coverage data
  const coverageResults = await validateCoverage(config, { lang });
  const result = coverageResults.find((r) => r.language === lang);
  const missingKeys = result?.missingKeys ?? [];
  const percent = result?.coveragePercent ?? 0;
  const total   = result?.totalKeys ?? 0;
  spinner.succeed(`Diff computed.`);

  logger.blank();

  if (missingKeys.length === 0) {
    logger.success(`"${lang}" has full coverage — no missing keys.`);
    logger.blank();

    if (options.output) {
      await writeFile(resolve(cwd, options.output), JSON.stringify([], null, 2) + "\n", "utf-8");
      logger.dim(`Empty list written to ${options.output}`);
      logger.blank();
    }
    return;
  }

  logger.raw(
    chalk.bold(`  Missing keys in ${chalk.red(lang)}`) +
    chalk.dim(` — ${missingKeys.length} of ${total} keys missing (${percent}% covered):`),
  );
  logger.blank();

  for (const key of missingKeys) {
    logger.raw(`  ${chalk.dim("·")} ${key}`);
  }

  logger.blank();
  logger.dim(
    `  Run \`localizer translate --missing-only --lang ${lang}\` to fill these keys.`,
  );
  logger.blank();

  // Optional JSON output
  if (options.output) {
    const outPath = resolve(cwd, options.output);
    await writeFile(
      outPath,
      JSON.stringify(
        {
          language:    lang,
          totalKeys:   total,
          missingCount: missingKeys.length,
          coveragePercent: percent,
          missingKeys,
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    logger.success(`Missing key list saved to ${options.output}`);
    logger.blank();
  }
}

export const diffCommand = new Command("diff")
  .description("Show keys missing from a target language relative to the default")
  .requiredOption("--lang <lang>", "Language to diff against the default")
  .option("--output <path>",       "Save missing key list as JSON")
  .action(async (options: DiffOptions) => {
    try {
      await runDiff(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
