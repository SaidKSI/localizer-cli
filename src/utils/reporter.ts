import { writeFile, readFile, mkdir, access } from "fs/promises";
import { resolve, basename, relative } from "path";
import type { ScanReport, ValidationResult, PipelineResult } from "@saidksi/localizer-core";
import { promptConfirm } from "./prompt.js";

// ─── JSON report writer ───────────────────────────────────────────────────────

/**
 * Write any serializable value to a JSON report file.
 * Used by audit --output, scan --output, diff --output.
 */
export async function writeReport(
  outputPath: string,
  data: unknown,
): Promise<void> {
  const absolute = resolve(outputPath);
  await writeFile(absolute, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate filename from a file or directory path.
 * E.g., "src/pages/Login.tsx" → "login-scan.json"
 * E.g., "src/pages" → "pages-scan.json"
 */
function generateScanFileName(filePath: string): string {
  const name = basename(filePath).replace(/\.(tsx?|jsx?)$/, "");
  return `${name.toLowerCase()}-scan.json`;
}

/**
 * Write a ScanReport to disk with metadata.
 * Auto-generates filename if outputPath is a directory.
 * Auto-creates .localizer/scan/ if needed.
 * Prompts for confirmation if file exists.
 *
 * Transforms results to be grouped by file with relative paths,
 * and removes column/surroundingCode fields.
 */
export async function writeScanReport(
  outputPath: string,
  report: ScanReport,
  sourceFilePath?: string,
  cwd = process.cwd(),
): Promise<string> {
  const scanDir = resolve(cwd, ".localizer", "scan");
  await mkdir(scanDir, { recursive: true });

  // If outputPath is just a flag with no value, auto-generate filename
  let finalPath = resolve(scanDir, sourceFilePath ? generateScanFileName(sourceFilePath) : "scan-report.json");

  // If outputPath is explicitly provided, use it (resolve relative to .localizer/scan/)
  if (outputPath && outputPath !== "true") {
    finalPath = resolve(scanDir, outputPath);
  }

  // Check if file exists and prompt for confirmation
  if (await fileExists(finalPath)) {
    const overwrite = await promptConfirm(
      `File ${basename(finalPath)} already exists. Overwrite?`,
      false,
    );
    if (!overwrite) {
      throw new Error("Aborted — file not overwritten.");
    }
  }

  // Group results by file (with relative paths) and remove column/surroundingCode
  const resultsByFile: Record<string, Array<{ line: number; value: string; context: string }>> = {};
  for (const result of report.results) {
    // Convert to relative path with forward slashes (cross-platform)
    const displayPath = relative(cwd, result.file).replace(/\\/g, "/");

    if (!resultsByFile[displayPath]) {
      resultsByFile[displayPath] = [];
    }

    resultsByFile[displayPath].push({
      line: result.line,
      value: result.value,
      context: result.context,
    });
  }

  // Add metadata to the report
  const reportWithMetadata = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalStrings: report.results.length,
      uniqueStrings: new Set(report.results.map((r) => r.value)).size,
      untranslatedStrings: report.results.filter((r) => !r.alreadyTranslated).length,
      filesScanned: Object.keys(resultsByFile).length,
    },
    results: resultsByFile,
  };

  await writeFile(finalPath, JSON.stringify(reportWithMetadata, null, 2) + "\n", "utf-8");
  return finalPath;
}
