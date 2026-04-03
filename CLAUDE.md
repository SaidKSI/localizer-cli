# CLAUDE.md - @saidksi/localizer-cli

Command-line tool for automating i18n workflows in JavaScript/TypeScript projects. This is a **public npm package** (`@saidksi/localizer-cli`) that provides 10 CLI commands for end-to-end i18n automation.

---

## Project Overview

**@saidksi/localizer-cli** is a standalone CLI app that:
- Scans codebases for hardcoded strings (via `@saidksi/localizer-core`)
- Generates semantic i18n keys using AI
- Translates strings into multiple languages
- Rewrites source code to use i18n function calls
- Validates translation coverage across languages
- Provides full automation pipeline and individual commands

**Depends on:** `@saidksi/localizer-core@0.1.1` (npm package)

**Status:** V0.1.1 — All 10 commands complete. Ready to publish (core v0.1.1 available).

**Package:** `@saidksi/localizer-cli@0.1.1` (npm)
**Repository:** https://github.com/SaidKSI/localizer-cli
**GitHub Actions:** ✅ CI + Auto-publish on tags (v*)

---

## Build Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript to dist/
pnpm test             # Run unit tests (Vitest)
pnpm test:coverage    # Coverage report
pnpm lint             # Type check
pnpm clean            # Remove dist/
```

---

## Architecture

### Directory Structure

```
src/
├── index.ts                    # Main entry point (exports main())
├── bin/
│   └── localizer.ts            # Executable entry point (shebang: #!/usr/bin/env node)
├── commands/                   # One file per CLI command
│   ├── init.ts                # Interactive setup wizard
│   ├── audit.ts               # Count all hardcoded strings
│   ├── scan.ts                # List strings in file/dir
│   ├── translate.ts           # Generate keys + translate
│   ├── rewrite.ts             # Replace strings with t() calls
│   ├── validate.ts            # Check translation coverage
│   ├── run.ts                 # Full pipeline
│   ├── add-lang.ts            # Add new language + translate
│   ├── status.ts              # Project health snapshot
│   └── diff.ts                # Show missing keys per language
└── utils/                      # Shared utilities
    ├── config.ts              # Load/validate .localizer/config.json
    ├── logger.ts              # Console formatting (colors, spinner)
    ├── prompt.ts              # User confirmation dialogs
    ├── reporter.ts            # Report formatting
    ├── json.ts                # JSON file utilities
    └── diff.ts                # Diff utilities

tests/
├── fixtures/                   # Test project files
└── [command].test.ts          # Tests per command
```

### Exported API

Main entry point for programmatic use:

```typescript
export async function main(): Promise<void>;
```

CLI is invoked via the executable:

```bash
localizer [command] [options]
```

---

## Commands

### User-Facing Commands (10 total)

| Command | AI? | Writes? | Purpose |
|---|---|---|---|
| `init` | test call | yes (config) | Interactive setup wizard |
| `audit` | no | no | Count all hardcoded strings |
| `scan` | no | no | List strings in file/dir |
| `translate` | yes | yes (JSON) | Generate keys + translate |
| `rewrite` | no | yes (source) | Replace strings with t() |
| `validate` | no | no | Check translation coverage |
| `run` | yes | yes (JSON+source) | Full pipeline |
| `add-lang` | yes | yes (JSON) | Add new language |
| `status` | no | no | Project health snapshot |
| `diff` | no | no | Show missing keys per language |

### Command Options (Common)

- `--dry-run` — Preview changes without writing
- `--yes` — Skip confirmation prompts
- `--force` — Ignore cache, re-process all files
- `--lang <lang1,lang2>` — Override target languages
- `--ci` — CI mode (exit 1 on warnings/missing translations)

---

## Key Constraints & Patterns

### TypeScript & Code Quality
- **Strict mode enabled** — `"strict": true` in tsconfig.json
- **No `any` types** — all types explicit
- **ESM only** — `import`/`export`, never `require()`
- **async/await only** — no callbacks or `.then()` chains

### CLI Patterns
- **File-by-file confirmation** — When processing multiple files, show diff and prompt per file (not "apply all")
- **Never modify silently** — `rewrite` and `run` always show diff → prompt → write
- **Bypass with --yes** — Users can skip confirmation with `--yes` flag
- **--dry-run support** — All write commands support preview-only mode

### Error Handling
- Clear error messages with context
- Exit with code 1 on errors
- Exit with code 0 on success
- Support `--ci` flag for automated deployments

### Testing
- **Vitest** (not Jest) — native ESM support
- **No real API calls** — mock Anthropic/OpenAI at SDK boundary
- **Integration tests** — use real `.localizer/config.json` and message files

---

## Key Modules

### config.ts

Load and validate `.localizer/config.json` from user's project.

**Features:**
- Uses `cosmiconfig` to search up directory tree
- Validates required fields
- Provides sensible defaults
- Merges CLI args with config

```typescript
interface LocalizeConfig {
  defaultLanguage: string;
  languages: string[];
  messagesDir: string;
  include: string[];
  exclude: string[];
  aiProvider: "anthropic" | "openai";
  aiModel: string;
  keyStyle: "dot.notation" | "snake_case";
  i18nLibrary: string;
  fileOrganization: "per-page";
  strictMode: boolean;
  glossary: Record<string, string>;
}
```

### logger.ts

Console output with formatting, colors, and spinner.

**Features:**
- Chalk for colors
- Ora for spinners
- Structured log levels (info, warn, error, success)

```typescript
logger.info("Starting scan...");
logger.success("Scan complete!");
logger.error("Failed to read file");
```

### prompt.ts

User confirmation dialogs.

**Features:**
- Yes/No prompts
- Multi-choice selection
- Input prompts (for API keys, language names)
- `--yes` flag to skip all prompts

### reporter.ts

Format and display reports (audit, validate, diff, status).

**Features:**
- Table formatting
- Summary statistics
- Readable output with colors

### Commands

Each command follows the **Commander.js** pattern:

```typescript
export const initCommand = new Command("init")
  .description("Interactive setup wizard")
  .action(async (options) => {
    // Implementation
  });
```

---

## Configuration File

`.localizer/config.json` created by `localizer init`:

```json
{
  "defaultLanguage": "en",
  "languages": ["en", "fr", "es"],
  "messagesDir": "./messages",
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "node_modules"],
  "aiProvider": "anthropic",
  "aiModel": "claude-3-sonnet-20240229",
  "keyStyle": "dot.notation",
  "i18nLibrary": "react-i18next",
  "fileOrganization": "per-page",
  "strictMode": true,
  "glossary": {}
}
```

---

## API Key Storage

API keys stored in global `~/.localizer` (not per-project .env):

```json
{
  "anthropic": {
    "apiKey": "sk_ant_***"
  }
}
```

**Why global?**
- Avoid committing secrets to repo
- Single source of truth across projects
- User only needs to authenticate once

---

## Core Dependencies

- `@saidksi/localizer-core` — Scanner, Rewriter, AIClient, Validator
- `commander` — CLI framework
- `cosmiconfig` — Config file discovery
- `chalk` — Colored console output
- `prompts` — Interactive prompts (Node.js alternative to `inquirer`)

---

## Common Patterns

### Confirmation Before Writing

```typescript
if (!options.yes) {
  const confirmed = await prompt({
    type: "confirm",
    message: "Apply changes?",
  });
  if (!confirmed) {
    logger.info("Cancelled.");
    return;
  }
}
```

### Dry-Run Support

```typescript
if (options.dryRun) {
  logger.info("Dry-run mode. No files written.");
  return;
}
```

### Spinner for Long Operations

```typescript
const spinner = ora("Scanning...").start();
try {
  const results = await scanner.scan(path);
  spinner.succeed(`Found ${results.length} strings`);
} catch (error) {
  spinner.fail("Scan failed");
  throw error;
}
```

---

## Development Workflow

### Adding a New Command

1. Create `src/commands/[name].ts` with command definition
2. Import in `src/index.ts` and register: `program.addCommand(nameCommand)`
3. Add tests in `tests/[name].test.ts`
4. Update README with new command docs

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Building

```bash
# Type check
pnpm lint

# Build (outputs to dist/, makes bin/localizer.js executable)
pnpm build

# Test locally
node dist/bin/localizer.js --help
```

---

## Publishing to npm

**Current Status:** Ready to publish (core v0.1.1 available on npm)

**How Publishing Works:**
1. Ensure `@saidksi/localizer-core@0.1.1` is available on npm
2. Lock file is committed to the repo: `pnpm-lock.yaml`
3. Tag release: `git tag v0.1.1`
4. Push tag: `git push origin v0.1.1`
5. GitHub Actions automatically:
   - Builds with `pnpm build`
   - Verifies CLI binary: `node dist/bin/localizer.js --help`
   - Publishes to npm using `NPM_TOKEN` secret
   - Watch at: https://github.com/SaidKSI/localizer-cli/actions

**Package Details:**
- **Name:** `@saidksi/localizer-cli`
- **Version:** `0.1.1`
- **npm:** https://www.npmjs.com/package/@saidksi/localizer-cli
- **Type:** ESM module
- **Bin:** `localizer` → `dist/bin/localizer.js`
- **Files:** `dist/` and `bin/` (gitignored in dist/)

**GitHub Secrets Required:**
- `NPM_TOKEN` — npm automation token (already configured)

---

## Confirmed Architecture Decisions

- **CLI Framework:** Commander.js (not yargs, not minimist)
- **Config Discovery:** cosmiconfig (searches up directory tree)
- **Console UI:** Chalk + Ora (colors + spinners)
- **Prompts:** prompts library (Node.js friendly, not inquirer)
- **File-by-file Confirmation:** Yes — show diff per file when processing directories
- **API Key Storage:** Global `~/.localizer` (not per-project .env)
- **Bypass Confirmation:** `--yes` flag (not `--force`, which triggers cache bypass)

---

## Related Repos

- **localizer-core** — Core library (Scanner, Rewriter, AIClient, Validator)
  - Repo: https://github.com/SaidKSI/localizer-core
  - npm: `@saidksi/localizer-core@0.1.1`
  - Status: Published

- **localizer-sample-app** — Testing app for CLI
  - Repo: https://github.com/SaidKSI/localizer-sample-app
  - Framework: React 18 + Vite + TypeScript
  - 40+ hardcoded strings for testing CLI
  - Languages: en, fr, es (ready for CLI testing)

- **localizer-dashboard** (Phase 2, private)
  - Will have web UI for translation management
  - Will depend on `localizer-core`

---

## Key Contacts & Resources

- **GitHub Issues:** https://github.com/SaidKSI/localizer-cli/issues
- **npm Package:** https://www.npmjs.com/package/@saidksi/localizer-cli
- **GitHub Actions:** https://github.com/SaidKSI/localizer-cli/actions
- **Author:** SaidKSI
- **License:** MIT

---

## Quick Reference

### Use localizer-cli when:
- Building the CLI app
- Adding new commands
- Working on prompts/UX
- Testing end-to-end workflows

### Use localizer-core when:
- Fixing scanner bugs
- Tuning AI prompts
- Improving code transformation
- Optimizing caching

### When to modify both:
- Adding new feature type (e.g., new file format support)
- Changing config structure
- New filtering rules
