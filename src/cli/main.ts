import { CLI_VERSION, HELP, parseArgs } from "./args.ts";
import { start } from "./serve.ts";

const parsed = parseArgs(process.argv.slice(2), process.cwd());
if (!parsed.ok) {
  console.error(parsed.error);
  console.error("Try sdoc-intake --help");
  process.exit(1);
}
if ("help" in parsed) {
  console.log(HELP);
  process.exit(0);
}
if ("version" in parsed) {
  console.log(CLI_VERSION);
  process.exit(0);
}

await start(parsed.args);
