import { Command } from "commander";
import { readFile, readdir, access } from "fs/promises";
import { join, resolve } from "path";
import ora from "ora";
import chalk from "chalk";
import { scanDirectory, validateApiKey } from "@saidksi/localizer-core";
import type { LocalizerConfig, AIProvider, KeyStyle, I18nLibrary } from "@saidksi/localizer-core";
import { logger } from "../utils/logger.js";
import { loadConfig, saveApiKey, writeProjectConfig } from "../utils/config.js";
import {
  promptConfirm,
  promptSelect,
  promptMultiselect,
  promptInput,
  promptSecret,
} from "../utils/prompt.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const COMMON_LANGUAGES = [
  { name: "Arabic (ar)",              value: "ar" },
  { name: "Chinese Simplified (zh)",  value: "zh" },
  { name: "Czech (cs)",               value: "cs" },
  { name: "Danish (da)",              value: "da" },
  { name: "Dutch (nl)",               value: "nl" },
  { name: "English (en)",             value: "en" },
  { name: "Finnish (fi)",             value: "fi" },
  { name: "French (fr)",              value: "fr" },
  { name: "German (de)",              value: "de" },
  { name: "Greek (el)",               value: "el" },
  { name: "Hebrew (he)",              value: "he" },
  { name: "Hindi (hi)",               value: "hi" },
  { name: "Hungarian (hu)",           value: "hu" },
  { name: "Indonesian (id)",          value: "id" },
  { name: "Italian (it)",             value: "it" },
  { name: "Japanese (ja)",            value: "ja" },
  { name: "Korean (ko)",              value: "ko" },
  { name: "Norwegian (nb)",           value: "nb" },
  { name: "Polish (pl)",              value: "pl" },
  { name: "Portuguese (pt)",          value: "pt" },
  { name: "Romanian (ro)",            value: "ro" },
  { name: "Russian (ru)",             value: "ru" },
  { name: "Spanish (es)",             value: "es" },
  { name: "Swedish (sv)",             value: "sv" },
  { name: "Thai (th)",                value: "th" },
  { name: "Turkish (tr)",             value: "tr" },
  { name: "Ukrainian (uk)",           value: "uk" },
  { name: "Vietnamese (vi)",          value: "vi" },
];

const ANTHROPIC_MODELS = [
  { name: "Claude Sonnet 4.6 (recommended)", value: "claude-sonnet-4-6" },
  { name: "Claude Opus 4.6 (most capable)",  value: "claude-opus-4-6"  },
  { name: "Claude Haiku 4.5 (fastest)",      value: "claude-haiku-4-5" },
];

const OPENAI_MODELS = [
  { name: "GPT-4o (recommended)", value: "gpt-4o"        },
  { name: "GPT-4 Turbo",          value: "gpt-4-turbo"   },
  { name: "GPT-3.5 Turbo",        value: "gpt-3.5-turbo" },
];

const PRESETS: Record<string, Partial<LocalizerConfig>> = {
  nextjs: {
    include:      ["./app", "./src"],
    exclude:      ["node_modules", "dist", ".next", "**/*.test.*", "**/*.stories.*"],
    i18nLibrary:  "next-intl",
    keyStyle:     "dot.notation",
    aiProvider:   "anthropic",
    aiModel:      "claude-sonnet-4-6",
    messagesDir:  "./messages",
  },
  expo: {
    include:      ["./src", "./app"],
    exclude:      ["node_modules", "dist", "**/*.test.*"],
    i18nLibrary:  "react-i18next",
    keyStyle:     "dot.notation",
    aiProvider:   "anthropic",
    aiModel:      "claude-sonnet-4-6",
    messagesDir:  "./messages",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function detectFramework(cwd: string): Promise<string | null> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["next"])   return "Next.js";
    if (deps["expo"])   return "Expo";
    if (deps["vue"])    return "Vue";
    if (deps["svelte"]) return "Svelte";
    if (deps["react"])  return "React";
    return null;
  } catch {
    return null;
  }
}

async function detectI18nLibrary(cwd: string): Promise<I18nLibrary | null> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["next-intl"])    return "next-intl";
    if (deps["react-intl"])   return "react-intl";
    if (deps["react-i18next"]) return "react-i18next";
    if (deps["vue-i18n"])     return "vue-i18n";
    if (deps["i18next"])      return "i18next";
    return null;
  } catch {
    return null;
  }
}

async function detectExistingLanguages(messagesDir: string): Promise<string[]> {
  try {
    const entries = await readdir(messagesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => /^[a-z]{2}(-[A-Z]{2})?$/.test(n));
  } catch {
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function smartDefaultIncludes(framework: string | null): string[] {
  if (framework === "Next.js") return ["./app", "./src"];
  if (framework === "Expo")    return ["./src", "./app"];
  return ["./src"];
}

function smartDefaultLibrary(framework: string | null): I18nLibrary {
  if (framework === "Next.js") return "next-intl";
  if (framework === "Vue")     return "vue-i18n";
  return "react-i18next";
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

interface InitOptions {
  reset?: boolean;
  preset?: string;
}

async function runWizard(cwd: string, options: InitOptions): Promise<void> {
  logger.blank();
  logger.raw(chalk.bold("  localizer init"));
  logger.blank();

  // ── Step 1: Detect framework and i18n library
  const framework = await detectFramework(cwd);
  if (framework) {
    logger.info(`Detected framework: ${chalk.cyan(framework)}`);
  }

  const detectedI18nLibrary = await detectI18nLibrary(cwd);
  if (detectedI18nLibrary) {
    logger.info(`Detected i18n library: ${chalk.cyan(detectedI18nLibrary)}`);
  }

  // ── Step 2: Check existing config
  const configPath = resolve(cwd, ".localizer", "config.json");
  const configExists = await fileExists(configPath);

  if (configExists && !options.reset) {
    const choice = await promptSelect<"overwrite" | "abort">(
      "A .localizer/config.json already exists. What would you like to do?",
      [
        { name: "Overwrite it",  value: "overwrite" },
        { name: "Abort",         value: "abort"     },
      ],
    );
    if (choice === "abort") {
      logger.warn("Aborted.");
      return;
    }
  }

  // ── Apply preset (skips most wizard steps)
  if (options.preset) {
    const preset = PRESETS[options.preset];
    if (!preset) logger.fatal(`Unknown preset "${options.preset}". Available: nextjs, expo`);
    await runPresetFlow(cwd, preset!, framework, detectedI18nLibrary);
    return;
  }

  // ── Step 3: Check existing messages directory
  const defaultMessagesDir = "./messages";
  const messagesAbsolute = resolve(cwd, defaultMessagesDir);
  const existingLanguages = await detectExistingLanguages(messagesAbsolute);
  const hasExistingTranslations = existingLanguages.length > 0;

  let defaultLanguage: string;
  let targetLanguages: string[];

  if (hasExistingTranslations) {
    // ── Branch A: existing translations found
    logger.info(`Found existing languages: ${chalk.cyan(existingLanguages.join(", "))}`);

    defaultLanguage = await promptSelect(
      "Which is your default (source) language?",
      existingLanguages.map((l) => ({
        name: COMMON_LANGUAGES.find((c) => c.value === l)?.name ?? l,
        value: l,
      })),
    );

    const addMore = await promptConfirm("Add more target languages (can add more later)?", false);
    if (addMore) {
      const extra = await promptMultiselect(
        "Select additional target languages:",
        COMMON_LANGUAGES.filter((l) => !existingLanguages.includes(l.value)),
      );
      targetLanguages = [...existingLanguages.filter((l) => l !== defaultLanguage), ...extra];
    } else {
      targetLanguages = existingLanguages.filter((l) => l !== defaultLanguage);
    }
  } else {
    // ── Branch B: no existing translations
    defaultLanguage = await promptSelect(
      "Default (source) language:",
      COMMON_LANGUAGES,
    );

    targetLanguages = await promptMultiselect(
      "Target languages to translate into:",
      COMMON_LANGUAGES.filter((l) => l.value !== defaultLanguage),
    );

    if (targetLanguages.length === 0) {
      logger.warn("No target languages selected. You can add them later with `localizer add-lang`.");
    }
  }

  // ── Step 5: Directories to include
  const defaultIncludes = smartDefaultIncludes(framework).join(", ");
  const includeRaw = await promptInput(
    "Directories to scan (comma-separated):",
    defaultIncludes,
  );
  const include = includeRaw.split(",").map((s) => s.trim()).filter(Boolean);

  // ── Step 6: Directories to exclude
  const excludeRaw = await promptInput(
    "Patterns to exclude (comma-separated):",
    "node_modules, dist, .next, **/*.test.*, **/*.stories.*",
  );
  const exclude = excludeRaw.split(",").map((s) => s.trim()).filter(Boolean);

  // ── Step 7: AI provider + model
  const aiProvider = await promptSelect<AIProvider>(
    "AI provider:",
    [
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "OpenAI (GPT)",       value: "openai"    },
    ],
  );

  const modelChoices = aiProvider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
  const aiModel = await promptSelect("Model:", modelChoices);

  // ── Step 8: Key style
  const keyStyle = await promptSelect<KeyStyle>(
    "Key naming style:",
    [
      { name: "dot.notation  (auth.sign_in_button)",  value: "dot.notation" },
      { name: "snake_case    (auth_sign_in_button)",  value: "snake_case"   },
    ],
  );

  // ── Step 9: i18n library
  let i18nLibrary: I18nLibrary;

  if (detectedI18nLibrary) {
    // Auto-use detected library (skip prompt)
    i18nLibrary = detectedI18nLibrary;
  } else {
    // Prompt if not detected
    const defaultLibrary = smartDefaultLibrary(framework);
    const i18nLibraryChoices: import("../utils/prompt.js").SelectChoice<I18nLibrary>[] = [
      { name: "react-i18next", value: "react-i18next" },
      { name: "next-intl",     value: "next-intl"     },
      { name: "react-intl",    value: "react-intl"    },
      { name: "vue-i18n",      value: "vue-i18n"      },
      { name: "i18next",       value: "i18next"        },
    ];
    i18nLibrary = await promptSelect<I18nLibrary>(
      "i18n library:",
      i18nLibraryChoices.map((c) => ({
        ...c,
        name: c.value === defaultLibrary ? `${c.name} (recommended for ${framework ?? "this project"})` : c.name,
      })),
    );
  }

  // ── Step 10: Strict mode
  const strictMode = await promptConfirm(
    "Enable strict mode? (validate exits with code 1 on any missing key)",
    false,
  );

  // ── Step 11: API key
  const envVar = aiProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const envKey = process.env[envVar];
  let apiKey: string | null = envKey ?? null;

  if (envKey) {
    logger.success(`Found ${envVar} in environment.`);
  } else {
    const enterKey = await promptConfirm(
      `No ${envVar} found. Enter your ${aiProvider} API key now?`,
      true,
    );
    if (enterKey) {
      apiKey = await promptSecret(`${aiProvider} API key:`);
    }
  }

  // ── Step 12: Validate API key
  if (apiKey) {
    const spinner = ora("Validating API key...").start();
    const valid = await validateApiKey(aiProvider, aiModel, apiKey);
    if (valid) {
      spinner.succeed("API key is valid.");
      if (!envKey) {
        const save = await promptConfirm("Save key to .localizer/.keys for future use?", true);
        if (save) {
          await saveApiKey(aiProvider, apiKey);
          logger.success("Key saved to .localizer/.keys");
        }
      }
    } else {
      spinner.fail("API key validation failed.");
      const proceed = await promptConfirm("Continue anyway?", false);
      if (!proceed) return;
    }
  }

  // ── Step 13: Build config + confirm
  const config: LocalizerConfig = {
    defaultLanguage,
    languages:        targetLanguages,
    messagesDir:      defaultMessagesDir,
    include,
    exclude,
    aiProvider,
    aiModel,
    keyStyle,
    i18nLibrary,
    overwriteExisting:     false,
    strictMode,
    glossary:              {},
  };

  logger.blank();
  logger.header("  Config summary:");
  logger.raw(chalk.dim(JSON.stringify(config, null, 2).replace(/^/gm, "    ")));
  logger.blank();

  const write = await promptConfirm("Write this config?", true);
  if (!write) {
    logger.warn("Aborted — nothing written.");
    return;
  }

  await writeProjectConfig(config, cwd);
  logger.success(`Wrote .localizer/config.json`);

  // ── Step 14: Gitignore — ensure .localizer/ itself is NOT gitignored
  // (config.json is committed; only .keys and cache.json are gitignored via .localizer/.gitignore)
  logger.dim("Created .localizer/.gitignore (ignores .keys and cache.json)");

  // ── Step 14: Fast pre-scan estimate
  await runPreScanEstimate(cwd, config);

  // ── Step 15: What's next
  printWhatsNext(config);
}

// ─── Preset flow (abbreviated wizard) ────────────────────────────────────────

async function runPresetFlow(
  cwd: string,
  preset: Partial<LocalizerConfig>,
  framework: string | null,
  detectedI18nLibrary?: I18nLibrary | null,
): Promise<void> {
  logger.info(`Applying preset defaults for ${chalk.cyan(framework ?? "this project")}`);

  const defaultLanguage = await promptSelect(
    "Default (source) language:",
    COMMON_LANGUAGES,
  );

  const targetLanguages = await promptMultiselect(
    "Target languages:",
    COMMON_LANGUAGES.filter((l) => l.value !== defaultLanguage),
  );

  const aiProvider = (preset.aiProvider ?? "anthropic") as AIProvider;
  const aiModel    = preset.aiModel ?? "claude-sonnet-4-6";
  const envVar     = aiProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const envKey     = process.env[envVar];
  let   apiKey: string | null = envKey ?? null;

  if (!envKey) {
    const enter = await promptConfirm(`Enter ${aiProvider} API key?`, true);
    if (enter) {
      apiKey = await promptSecret(`${aiProvider} API key:`);
      if (apiKey) {
        const spinner = ora("Validating API key...").start();
        const valid = await validateApiKey(aiProvider, aiModel, apiKey);
        valid ? spinner.succeed("Valid.") : spinner.fail("Invalid key.");
        if (valid) {
          await saveApiKey(aiProvider, apiKey);
          logger.success("Key saved to .localizer/.keys");
        }
      }
    }
  }

  const config: LocalizerConfig = {
    defaultLanguage,
    languages:         targetLanguages,
    messagesDir:       preset.messagesDir  ?? "./messages",
    include:           preset.include      ?? ["./src"],
    exclude:           preset.exclude      ?? ["node_modules", "dist"],
    aiProvider,
    aiModel,
    keyStyle:          (preset.keyStyle    ?? "dot.notation") as KeyStyle,
    i18nLibrary:       detectedI18nLibrary ?? (preset.i18nLibrary ?? "react-i18next") as I18nLibrary,
    overwriteExisting:    false,
    strictMode:           false,
    glossary:             {},
  };

  const write = await promptConfirm("Write config?", true);
  if (!write) { logger.warn("Aborted."); return; }

  await writeProjectConfig(config, cwd);
  logger.success("Wrote .localizer/config.json");
  await runPreScanEstimate(cwd, config);
  printWhatsNext(config);
}

// ─── Pre-scan estimate ────────────────────────────────────────────────────────

async function runPreScanEstimate(
  cwd: string,
  config: LocalizerConfig,
): Promise<void> {
  logger.blank();
  const spinner = ora("Running fast pre-scan to estimate work...").start();
  try {
    const results = await Promise.all(
      config.include.map((dir) =>
        scanDirectory(resolve(cwd, dir), config).catch(() => []),
      ),
    );
    const allResults = results.flat();
    const unique = new Set(allResults.map((r) => r.value)).size;
    const estimatedCost = (unique * 0.001).toFixed(3);
    spinner.succeed(`Pre-scan complete.`);
    logger.dim(`Found ~${allResults.length} strings (${unique} unique) across ${config.include.join(", ")}`);
    logger.dim(`Estimated AI cost for first full run: ~$${estimatedCost}`);
  } catch {
    spinner.warn("Pre-scan skipped — source directories not found yet.");
  }
}

// ─── What's next panel ────────────────────────────────────────────────────────

function printWhatsNext(config: LocalizerConfig): void {
  logger.blank();
  logger.raw(chalk.bold("  What's next:"));
  logger.blank();
  logger.raw(`  ${chalk.dim("# See all untranslated strings across your app")}`);
  logger.raw(`  ${chalk.cyan("localizer audit")}`);
  logger.blank();
  logger.raw(`  ${chalk.dim("# Localizer a single file (scan → translate → rewrite → validate)")}`);
  logger.raw(`  ${chalk.cyan("localizer run --file ./src/pages/Login.tsx")}`);
  logger.blank();
  if (config.languages.length > 0) {
    logger.raw(`  ${chalk.dim("# Check key coverage across all languages")}`);
    logger.raw(`  ${chalk.cyan("localizer validate")}`);
    logger.blank();
  }
}

// ─── Command export ───────────────────────────────────────────────────────────

export const initCommand = new Command("init")
  .description("Interactive setup wizard — creates .localizer.config.json")
  .option("--reset",          "Wipe existing config and start fresh")
  .option("--preset <name>",  "Skip wizard, apply preset defaults (nextjs | expo)")
  .action(async (options: InitOptions) => {
    try {
      await runWizard(process.cwd(), options);
    } catch (err: unknown) {
      // Gracefully handle Ctrl+C during prompts
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User force closed") || msg.includes("ExitPromptError")) {
        logger.blank();
        logger.warn("Init cancelled.");
        process.exit(0);
      }
      logger.fatal(msg);
    }
  });
