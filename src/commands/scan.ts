import { Command } from "commander";
import { resolve, relative } from "path";
import ora from "ora";
import chalk from "chalk";
import {
  scanFile,
  scanDirectory,
  buildScanReport,
  type ScanResult,
  type ScanReport,
} from "@saidksi/localizer-core";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";
import { writeScanReport } from "../utils/reporter.js";

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Print a human-readable table of scan results grouped by file.
 *
 * src/pages/Login.tsx
 * ──────────────────────────────────────────────────────
 *   14:8   "Welcome back"        JSXText inside <h1>
 *   18:12  "Enter your email"    "placeholder" attribute on <input>
 *   22:6   "Sign in"             JSXText inside <button>
 */
function printScanResults(results: ScanResult[], cwd: string): void {
  if (results.length === 0) {
    logger.success("No untranslated strings found.");
    return;
  }

  // Group by file
  const byFile = new Map<string, ScanResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.file) ?? [];
    existing.push(r);
    byFile.set(r.file, existing);
  }

  logger.blank();

  for (const [file, fileResults] of byFile) {
    const relPath = relative(cwd, file);
    const divider = "─".repeat(Math.min(relPath.length + 4, 60));

    logger.raw(`  ${chalk.bold(chalk.cyan(relPath))}`);
    logger.raw(`  ${chalk.dim(divider)}`);

    for (const r of fileResults) {
      const loc     = chalk.dim(`${r.line}:${r.column}`.padEnd(8));
      const value   = chalk.yellow(`"${r.value}"`).padEnd(42);
      const context = chalk.dim(r.context);
      const already = r.alreadyTranslated ? chalk.green(" ✔ already translated") : "";
      logger.raw(`    ${loc}  ${value}  ${context}${already}`);
    }

    logger.blank();
  }

  const totalFiles = byFile.size;
  const untranslated = results.filter((r) => !r.alreadyTranslated);

  logger.raw(
    `  ${chalk.bold("Found")} ${chalk.yellow(untranslated.length)} untranslated string${untranslated.length !== 1 ? "s" : ""}` +
    ` (${results.length - untranslated.length} already translated)` +
    ` in ${totalFiles} file${totalFiles !== 1 ? "s" : ""}.`,
  );
  logger.blank();
}

function printNextSteps(options: ScanOptions): void {
  if (options.file) {
    logger.raw(chalk.dim(`  Run \`localizer translate --file ${options.file}\` to generate translations.`));
    logger.raw(chalk.dim(`  Run \`localizer run --file ${options.file}\` for the full pipeline.`));
  } else if (options.dir) {
    logger.raw(chalk.dim(`  Run \`localizer run --dir ${options.dir}\` for the full pipeline.`));
  }
  logger.blank();
}

// ─── Command ──────────────────────────────────────────────────────────────────

interface ScanOptions {
  file?: string;
  dir?: string;
  report?: boolean;
  output?: string | boolean;
}

async function runScan(options: ScanOptions): Promise<void> {
  const cwd    = process.cwd();
  const config = await loadConfig(cwd).catch((err: unknown) =>
    logger.fatal(err instanceof Error ? err.message : String(err)),
  );

  const spinner = ora("Scanning...").start();

  let report: ScanReport = { generatedAt: new Date().toISOString(), results: [] };

  try {
    if (options.file) {
      report = await buildScanReport({ file: resolve(cwd, options.file) }, config);
    } else if (options.dir) {
      report = await buildScanReport({ dir: resolve(cwd, options.dir) }, config);
    } else {
      // Scan all include dirs and merge into a single report
      const all = await Promise.all(
        config.include.map((dir) =>
          scanDirectory(resolve(cwd, dir), config).catch(() => [] as ScanResult[]),
        ),
      );
      report = {
        generatedAt: new Date().toISOString(),
        results: all.flat(),
      };
    }
  } catch (err: unknown) {
    spinner.fail("Scan failed.");
    logger.fatal(err instanceof Error ? err.message : String(err));
  }

  const untranslated = report.results.filter((r) => !r.alreadyTranslated);
  spinner.succeed(
    `Scanned ${new Set(report.results.map((r) => r.file)).size} files — ` +
    `${untranslated.length} untranslated string${untranslated.length !== 1 ? "s" : ""} found.`,
  );

  // --report: print JSON to stdout and exit
  if (options.report) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Default: human-readable table
  printScanResults(report.results, cwd);
  printNextSteps(options);

  // --output: save JSON to file (.localizer/scan/)
  if (options.output === true || typeof options.output === "string") {
    const sourceFile = options.file || options.dir || "";
    const outputFilename = typeof options.output === "string" ? options.output : "";
    const outputPath = await writeScanReport(outputFilename, report, sourceFile, cwd);
    logger.success(`Report saved to ${relative(cwd, outputPath)}`);
  }
}

export const scanCommand = new Command("scan")
  .description("Scan a file or directory and show a detailed string-by-string report")
  .option("--file <file>",     "Scope to a single file")
  .option("--dir <dir>",       "Scope to a directory")
  .option("--report",          "Print JSON report to stdout (pipe-friendly)")
  .option("--output [path]",   "Save JSON report to .localizer/scan/ (auto-generates filename if not provided)")
  .action(async (options: ScanOptions) => {
    try {
      await runScan(options);
    } catch (err: unknown) {
      logger.fatal(err instanceof Error ? err.message : String(err));
    }
  });
