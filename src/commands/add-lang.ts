import { Command } from "commander";
import { resolve, join, basename, extname } from "path";
import { readdir } from "fs/promises";
import ora from "ora";
import chalk from "chalk";
import { translateExistingKeys, type ExistingKeyEntry } from "@saidksi/localizer-core";
import { logger } from "../utils/logger.js";
import { loadConfig, requireApiKey, writeProjectConfig } from "../utils/config.js";
import { readFile } from "fs/promises";
import { flattenJson } from "../utils/json.js";

async function readAllEntries(
  messagesDir: string,
  sourceLang: string,
): Promise<ExistingKeyEntry[]> {
  const langDir = join(resolve(messagesDir), sourceLang);
  let files: string[];

  try {
    const all = await readdir(langDir);
    files = all.filter((f) => f.endsWith(".json"));
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

// ─── Command ──────────────────────────────────────────────────────────────────

interface AddLangOptions {
  lang: string;
  from?: string;
  dryRun?: boolean;
}

async function runAddLang(options: AddLangOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );
  const apiKey = await requireApiKey(config.aiProvider).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  const newLang    = options.lang.trim().toLowerCase();
  const sourceLang = options.from ?? config.defaultLanguage;

  // Guard: already configured (e.g. add-lang was partially interrupted)
  if (config.languages.includes(newLang)) {
    logger.warn(`Language "${newLang}" is already in your config.`);
    logger.dim(`  To fill missing keys: localizer translate --from-existing --missing-only --lang ${newLang}`);
    return;
  }

  // Guard: source language must exist
  const knownLangs = [config.defaultLanguage, ...config.languages];
  if (!knownLangs.includes(sourceLang)) {
    logger.fatal(`Source language "${sourceLang}" is not in your config.`);
  }

  logger.header(`Adding language: ${chalk.cyan(newLang)}`);
  logger.dim(`  Source: ${sourceLang}  →  Target: ${newLang}`);
  logger.blank();

  // ── Read existing keys
  const readSpinner = ora(`Reading keys from ${sourceLang}…`).start();
  const entries = await readAllEntries(config.messagesDir, sourceLang);
  readSpinner.succeed(`Found ${entries.length} key${entries.length !== 1 ? "s" : ""} in "${sourceLang}".`);

  if (entries.length === 0) {
    logger.warn(`No keys found in messages/${sourceLang}/. Run \`localizer translate\` first.`);
    return;
  }

  // ── Translate into new language
  const aiSpinner = ora(`Translating ${entries.length} keys into "${newLang}"…`).start();
  const addLangOpts: { dryRun?: boolean; overwrite?: boolean; langs?: string[] } = {
    overwrite: false,
    langs: [newLang],
  };
  if (options.dryRun !== undefined) addLangOpts.dryRun = options.dryRun;
  const result = await translateExistingKeys(entries, config, apiKey, addLangOpts);
  aiSpinner.succeed(`Translated ${result.translated} key${result.translated !== 1 ? "s" : ""}.`);

  if (result.aiCostUsd > 0) {
    logger.dim(`  Estimated cost: ~$${result.aiCostUsd.toFixed(4)}`);
  }

  if (options.dryRun) {
    logger.blank();
    logger.warn("Dry run — no files written, config not updated.");
    return;
  }

  // ── Update config
  const updatedConfig = {
    ...config,
    languages: [...config.languages, newLang],
  };
  await writeProjectConfig(updatedConfig, cwd);

  logger.blank();
  logger.success(`Added "${newLang}" to .localizer.config.json`);
  logger.dim(`  Files written: ${result.messagesWritten.length}`);
  logger.dim(`  Run \`localizer validate --lang ${newLang}\` to check coverage.`);
  logger.blank();
}

export const addLangCommand = new Command("add-lang")
  .description("Add a new target language and translate all existing keys into it")
  .requiredOption("--lang <lang>", "ISO 639-1 language code to add (e.g. ja)")
  .option("--from <lang>",         "Source language to translate from (default: config.defaultLanguage)")
  .option("--dry-run",             "Preview translations without writing files")
  .action(async (options: AddLangOptions) => {
    try {
      await runAddLang(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
