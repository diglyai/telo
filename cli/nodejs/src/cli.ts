#!/usr/bin/env node

import { Kernel } from "@telorun/runtime";
import * as fs from "fs/promises";
import * as path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

function createLogger(verbose: boolean) {
  const useColor = process.stdout.isTTY;
  const wrap = (code: string, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
  return {
    info: (...args: any[]) => console.log(...args),
    ok: (text: string) => wrap("32", text),
    warn: (text: string) => wrap("33", text),
    error: (text: string) => wrap("31", text),
    dim: (text: string) => wrap("2", text),
    verbose,
  };
}

async function run(argv: {
  path: string;
  verbose: boolean;
  debug: boolean;
  snapshotOnExit: boolean;
}) {
  const inputPath = path.resolve(argv.path);
  let inputStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    inputStat = await fs.stat(inputPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error reading path: ${inputPath}: ${message}`);
    process.exit(1);
  }

  const log = createLogger(argv.verbose);

  try {
    const kernel = new Kernel();
    if (argv.verbose) {
      kernel.on("*", (event: any) => {
        log.info(`${event.name}: ${JSON.stringify(event.payload)}`);
      });
    }

    if (argv.debug) {
      const debugDir = path.join(process.cwd(), ".telo-debug");
      const eventStreamPath = path.join(debugDir, "events.jsonl");
      await kernel.enableEventStream(eventStreamPath);
      log.info(`Event stream enabled: ${eventStreamPath}`);
    }

    if (inputStat.isDirectory()) {
      await kernel.loadDirectory(inputPath);
    } else {
      await kernel.loadFromConfig(inputPath);
    }

    await kernel.start();
    if (kernel.exitCode !== 0) {
      process.exit(kernel.exitCode);
    }
  } catch (error) {
    console.error("Error loading runtime:", error instanceof Error ? error.stack : String(error));
    process.exit(1);
  }
}

yargs(hideBin(process.argv))
  .scriptName("telo")
  .usage("$0 <command> [options]")
  .command(
    ["run <path>", "$0 <path>"],
    "Run a Telo runtime from a manifest file or directory",
    (yargs) =>
      yargs.positional("path", {
        describe: "Path to a runtime.yaml file or directory",
        type: "string",
        demandOption: true,
      }),
    async (argv) => {
      await run(argv as any);
    },
  )
  .option("verbose", {
    type: "boolean",
    default: false,
    describe: "Enable verbose logging",
  })
  .option("debug", {
    type: "boolean",
    default: false,
    describe: "Enable debug event streaming",
  })
  .option("snapshot-on-exit", {
    type: "boolean",
    default: false,
    describe: "Capture a snapshot on exit",
  })
  .demandCommand(1, "Please specify a command or path to run")
  .strict()
  .help()
  .version()
  .parse();
