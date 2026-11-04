import { runCli } from "./compose.js";

/** The real process: arguments, environment and standard streams. */
export function runProcess(): Promise<number> {
  return runCli(
    process.argv.slice(2),
    process.env,
    {
      out: (text) => void process.stdout.write(text),
      err: (text) => void process.stderr.write(text),
    },
  );
}
