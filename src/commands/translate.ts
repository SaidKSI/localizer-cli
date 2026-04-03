import { Command } from "commander";
import { resolve, join, basename, extname } from "path";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import ora from "ora";
import chalk from "chalk";
import {
  scanFile,
  scanDirectory,
  translateStrings,
  translateExistingKeys,
  type ScanResult,
  type ExistingKeyEntry,
  type TranslateResult,
} from "@saidksi/localizer-core";
import { logger } from "../utils/logger.js";
import { loadConfig, requireApiKey } from "../utils/config.js";
import { flattenJson } from "../utils/json.js";

/**
 * Write translate results to a JSON file for debugging.
 * Includes scan results with resolved keys, dedup info, and AI calls made.
 * Outputs to .localizer/translate/{pageName}_translate.json
 */
async function writeDebugOutput(
  cwd: string,
  file: string | undefined,
  translateResult: TranslateResult,
  scanResults: ScanResult[],
  uniqueStrings: number,
): Promise<string[]> {
  // Create .localizer/translate directory
  const translateDir = resolve(cwd, ".localizer", "translate");
  await mkdir(translateDir, { recursive: true });

  // Group scan results by file and page name
  const byFile = new Map<string, ScanResult[]>();
  for (const result of scanResults) {
    const existing = byFile.get(result.file);
    if (existing) {
      existing.push(result);
    } else {
      byFile.set(result.file, [result]);
    }
  }

  const writtenPaths: string[] = [];

  // Write debug output for each file scanned
  for (const [sourceFile, fileResults] of byFile) {
    const pageName = basename(sourceFile, extname(sourceFile));
    const debugFileName = `${pageName}_translate.json`;
    const debugOutputPath = join(translateDir, debugFileName);

    // Group results by resolved key to show deduplication
    const byKey = new Map<string | null, ScanResult[]>();
    for (const result of fileResults) {
      const key = result.resolvedKey ?? "(NOT TRANSLATED)";
      const existing = byKey.get(key);
      if (existing) {
        existing.push(result);
      } else {
        byKey.set(key, [result]);
      }
    }

    // Build debug output
    const debugOutput = {
      metadata: {
        generatedAt: new Date().toISOString(),
        sourceFile: sourceFile,
        outputPath: debugOutputPath,
      },
      summary: {
        totalScanned: fileResults.length,
        uniqueStrings: uniqueStrings,
        translated: translateResult.uniqueStrings,
        aiCalls: translateResult.aiCalls,
        costUsd: translateResult.aiCostUsd,
        filesWritten: translateResult.messagesWritten,
      },
      details: {
        byResolvedKey: Array.from(byKey.entries()).map(([key, results]) => ({
          resolvedKey: key,
          count: results.length,
          examples: results.slice(0, 3).map(r => ({
            file: r.file,
            line: r.line,
            value: r.value,
            context: r.context,
          })),
        })),
      },
      missingTranslations: fileResults
        .filter(r => !r.resolvedKey)
        .map(r => ({
          file: r.file,
          line: r.line,
          value: r.value,
          context: r.context,
        })),
    };

    await writeFile(debugOutputPath, JSON.stringify(debugOutput, null, 2) + "\n", "utf-8");
    writtenPaths.push(debugOutputPath);
  }

  return writtenPaths;
}

/**
 * Read all pages from messages/{defaultLang}/ and return ExistingKeyEntry[].
 * If `page` is provided, only read that page file.
 */
async function readExistingEntries(
  messagesDir: string,
  defaultLang: string,
  page?: string,
): Promise<ExistingKeyEntry[]> {
  const langDir = join(resolve(messagesDir), defaultLang);
  let files: string[];

  try {
    const all = await readdir(langDir);
    files = all.filter((f) => f.endsWith(".json"));
    if (page) files = files.filter((f) => basename(f, ".json") === page);
  } catch {
    return [];
  }

  const entries: ExistingKeyEntry[] = [];
  for (const file of files) {
    const pageName = basename(file, extname(file));
    const raw = await readFile(join(langDir, file), "utf-8").catch(() => "{}");
    const flat = flattenJson(JSON.parse(raw) as Record<string, unknown>);
    for (const [key, value] of Object.entries(flat)) {
      entries.push({ key, value, pageName });
    }
  }
  return entries;
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printTranslateResult(
  translated: number,
  aiCalls: number,
  messagesWritten: string[],
  aiCostUsd: number,
  dryRun: boolean,
): void {
  logger.blank();
  if (dryRun) {
    logger.warn("Dry run — no files written.");
    logger.dim(`Would translate ${translated} unique string${translated !== 1 ? "s" : ""} via ${aiCalls} AI call${aiCalls !== 1 ? "s" : ""}.`);
    return;
  }

  logger.success(
    `Translated ${chalk.yellow(translated)} string${translated !== 1 ? "s" : ""} via ${aiCalls} AI call${aiCalls !== 1 ? "s" : ""}.`,
  );

  const uniqueFiles = [...new Set(messagesWritten)];
  for (const f of uniqueFiles) {
    logger.dim(`Updated ${f}`);
  }

  if (aiCostUsd > 0) {
    logger.dim(`Estimated cost: ~$${aiCostUsd.toFixed(4)}`);
  }
  logger.blank();
}

// ─── Command ──────────────────────────────────────────────────────────────────

interface TranslateOptions {
  file?: string;
  dir?: string;
  lang?: string;
  fromExisting?: boolean;
  missingOnly?: boolean;
  dryRun?: boolean;
  output?: boolean;
}

async function runTranslate(options: TranslateOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );
  const apiKey = await requireApiKey(config.aiProvider).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  // --lang override: replace config.languages for this run
  const langs = options.lang
    ? options.lang.split(",").map((l) => l.trim()).filter(Boolean)
    : config.languages;

  const effectiveConfig = { ...config, languages: langs };

  // ── Path A: --from-existing
  if (options.fromExisting) {
    const page = options.file
      ? basename(options.file, extname(options.file)).toLowerCase()
      : undefined;

    const spinner = ora("Reading existing translation keys...").start();
    const entries = await readExistingEntries(
      config.messagesDir,
      config.defaultLanguage,
      page,
    );
    spinner.succeed(`Found ${entries.length} existing key${entries.length !== 1 ? "s" : ""}.`);

    if (entries.length === 0) {
      logger.warn("No existing keys found. Run `localizer translate --file <file>` first.");
      return;
    }

    const aiSpinner = ora(`Translating ${entries.length} keys into ${langs.join(", ")}...`).start();
    const existingOpts: { dryRun?: boolean; overwrite?: boolean; langs?: string[] } = {
      overwrite: !options.missingOnly,
    };
    if (options.dryRun !== undefined) existingOpts.dryRun = options.dryRun;
    const result = await translateExistingKeys(entries, effectiveConfig, apiKey, existingOpts);
    aiSpinner.succeed("Translation complete.");

    printTranslateResult(
      result.translated,
      result.aiCalls,
      result.messagesWritten,
      result.aiCostUsd,
      options.dryRun ?? false,
    );
    return;
  }

  // ── Path B: scan-based translation
  const scanSpinner = ora("Scanning for untranslated strings...").start();
  let results: ScanResult[] = [];

  try {
    if (options.file) {
      results = await scanFile(resolve(cwd, options.file), effectiveConfig);
    } else if (options.dir) {
      results = await scanDirectory(resolve(cwd, options.dir), effectiveConfig);
    } else {
      const all = await Promise.all(
        config.include.map((d) =>
          scanDirectory(resolve(cwd, d), effectiveConfig).catch(() => [] as ScanResult[]),
        ),
      );
      results = all.flat();
    }
  } catch (err: unknown) {
    scanSpinner.fail("Scan failed.");
    logger.fatal(err instanceof Error ? err.message : String(err));
  }

  const untranslated = results.filter((r) => !r.alreadyTranslated);
  scanSpinner.succeed(`Found ${untranslated.length} untranslated string${untranslated.length !== 1 ? "s" : ""}.`);

  if (untranslated.length === 0) {
    logger.success("Nothing to translate.");
    return;
  }

  const aiSpinner = ora(`Calling ${effectiveConfig.aiProvider} (${effectiveConfig.aiModel})...`).start();

  const translateOpts: import("@saidksi/localizer-core").TranslateOptions = {
    overwrite: !options.missingOnly,
  };
  if (options.dryRun !== undefined) translateOpts.dryRun = options.dryRun;
  const translateResult = await translateStrings(
    results,
    effectiveConfig,
    apiKey,
    translateOpts,
  );

  aiSpinner.succeed("Translation complete.");

  // Write debug output to .localizer/translate/ only if --output is specified
  if (options.output) {
    const debugSpinner = ora("Writing debug output...").start();
    try {
      const debugPaths = await writeDebugOutput(
        cwd,
        options.file,
        translateResult,
        translateResult.results,
        translateResult.uniqueStrings,
      );
      debugSpinner.succeed(`Debug output written to .localizer/translate/`);
      for (const path of debugPaths) {
        logger.dim(`  ${path}`);
      }
    } catch (err: unknown) {
      debugSpinner.fail("Failed to write debug output.");
      logger.warn(err instanceof Error ? err.message : String(err));
    }
  }

  printTranslateResult(
    translateResult.uniqueStrings,
    translateResult.aiCalls,
    translateResult.messagesWritten,
    translateResult.aiCostUsd,
    options.dryRun ?? false,
  );
}

export const translateCommand = new Command("translate")
  .description("Run AI to generate keys and translations, write to messages JSON")
  .option("--file <file>",    "Scope to a single file")
  .option("--dir <dir>",      "Scope to a directory")
  .option("--lang <langs>",   "Target languages override (comma-separated, e.g. fr,ar)")
  .option("--from-existing",  "Translate all keys in the default language JSON (no scan)")
  .option("--missing-only",   "Only translate keys missing from target language JSONs")
  .option("--dry-run",        "Preview AI output without writing files")
  .option("--output",         "Write debug output to .localizer/translate/")
  .action(async (options: TranslateOptions) => {
    try {
      await runTranslate(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
