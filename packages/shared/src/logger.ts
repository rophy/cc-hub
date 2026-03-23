import pino from "pino";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

export type LoggerOptions = {
  name: string;
  level?: string;
} & (
  | { transport: "stdout" }
  | { transport: "file"; filePath: string }
);

export function createLogger(opts: LoggerOptions): pino.Logger {
  const level = opts.level || process.env.CC_HUB_LOG_LEVEL || "info";

  if (opts.transport === "file") {
    const dir = join(homedir(), ".cc-hub");
    mkdirSync(dir, { recursive: true });
    return pino(
      { name: opts.name, level },
      pino.destination(opts.filePath),
    );
  }

  return pino({ name: opts.name, level });
}
