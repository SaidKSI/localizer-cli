import { Command } from "commander";
import { createRequire } from "module";

import { initCommand }      from "./commands/init.js";
import { auditCommand }     from "./commands/audit.js";
import { scanCommand }      from "./commands/scan.js";
import { translateCommand } from "./commands/translate.js";
import { rewriteCommand }   from "./commands/rewrite.js";
import { validateCommand }  from "./commands/validate.js";
import { runCommand }       from "./commands/run.js";
import { addLangCommand }   from "./commands/add-lang.js";
import { statusCommand }    from "./commands/status.js";
import { diffCommand }      from "./commands/diff.js";

// Read version from package.json without importing JSON (ESM-safe)
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export async function main(): Promise<void> {
  const program = new Command();

  program
    .name("localizer")
    .description("Automate the full i18n workflow for JavaScript and TypeScript codebases")
    .version(version, "-v, --version", "Print the current version")
    .helpOption("-h, --help", "Show help")
    // Show help when called with no arguments
    .addHelpCommand("help [command]", "Show help for a command")
    .configureOutput({
      // Route errors through our logger style
      outputError: (str, write) => write(`\n  ${str}`),
    });

  // Register all commands
  program.addCommand(initCommand);
  program.addCommand(auditCommand);
  program.addCommand(scanCommand);
  program.addCommand(translateCommand);
  program.addCommand(rewriteCommand);
  program.addCommand(validateCommand);
  program.addCommand(runCommand);
  program.addCommand(addLangCommand);
  program.addCommand(statusCommand);
  program.addCommand(diffCommand);

  // Show help when called with no arguments
  if (process.argv.length <= 2) {
    program.help();
  }

  await program.parseAsync(process.argv);
}
