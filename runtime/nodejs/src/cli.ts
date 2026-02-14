#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { Kernel } from './kernel';

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const debug = args.includes('--debug');
  const snapshotOnExit = args.includes('--snapshot-on-exit');

  const filteredArgs = args.filter(
    (arg) =>
      arg !== '--verbose' && arg !== '--debug' && arg !== '--snapshot-on-exit',
  );

  if (filteredArgs.length === 0) {
    console.error(
      'Usage: digly [--verbose] [--debug] [--snapshot-on-exit] <runtime.yaml|directory>',
    );
    console.error('Example: digly --verbose --debug ./runtime.yaml');
    process.exit(1);
  }

  const inputPath = path.resolve(filteredArgs[0]);
  let inputStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    inputStat = await fs.stat(inputPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error reading path: ${inputPath}: ${message}`);
    process.exit(1);
  }

  const isDirectory = inputStat.isDirectory();
  const log = createLogger(verbose);

  // log.info(`Digly Runtime v1.0`);
  // log.info(`Loading from: ${inputPath}`);

  try {
    const kernel = new Kernel();
    if (verbose) {
      kernel.on('*', (event) => {
        log.info(`${event.name}: ${JSON.stringify(event.payload)}`);
      });
    }

    // Enable event streaming if debug flag is set
    if (debug) {
      const debugDir = path.join(process.cwd(), '.digly-debug');
      const eventStreamPath = path.join(debugDir, 'events.jsonl');
      await kernel.enableEventStream(eventStreamPath);
      log.info(`Event stream enabled: ${eventStreamPath}`);
    }

    // Load from manifest or directory
    if (isDirectory) {
      await kernel.loadDirectory(inputPath);
    } else {
      await kernel.loadFromConfig(inputPath);
    }

    await kernel.start();
    if (kernel.exitCode !== 0) {
      process.exit(kernel.exitCode);
    }
  } catch (error) {
    console.error(
      'Error loading runtime:',
      error instanceof Error ? error.stack : String(error),
    );
    process.exit(1);
  }
}

function createLogger(verbose: boolean) {
  const useColor = process.stdout.isTTY;
  const wrap = (code: string, text: string) =>
    useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
  return {
    info: (...args: any[]) => console.log(...args),
    ok: (text: string) => wrap('32', text),
    warn: (text: string) => wrap('33', text),
    error: (text: string) => wrap('31', text),
    dim: (text: string) => wrap('2', text),
    verbose,
  };
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
