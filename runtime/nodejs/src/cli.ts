#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { Kernel } from './kernel';

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const filteredArgs = args.filter((arg) => arg !== '--verbose');

  if (filteredArgs.length === 0) {
    console.error('Usage: digly [--verbose] <runtime.yaml|directory>');
    console.error('Example: digly --verbose ./runtime.yaml');
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
  if (verbose) {
    process.env.DIGLY_VERBOSE = '1';
  }

  log.info(`Digly Runtime v1.0`);
  log.info(`Loading from: ${inputPath}`);

  try {
    if (!verbose) {
      suppressDebugLogs();
    }
    const kernel = new Kernel();

    // Load from runtime configuration or directory
    if (isDirectory) {
      await kernel.load(inputPath);
    } else {
      await kernel.loadFromConfig(inputPath);
    }

    // const uniqueModules = Array.from(kernel.moduleInstances.values());
    // log.info('\nModules');
    // if (uniqueModules.length > 0) {
    //   for (const module of uniqueModules) {
    //     const kinds =
    //       module.resourceKinds.length > 0
    //         ? module.resourceKinds.join(', ')
    //         : 'none';
    //     log.info(`  - ${module.name} (handles: ${kinds})`);
    //   }
    // } else {
    //   log.info('  (none)');
    // }

    const count = countResources(kernel);
    if (count === 0) {
      // log.info(log.warn('\nNo resources defined.'));
    } else {
      // log.info(`\nResources: ${count}`);
      // log.info('\nStarting modules...');
      const startErrors = await startModules(kernel, log);
      if (startErrors.length > 0) {
        throw new Error('One or more modules failed to start');
      }

      log.info(`\n${log.ok('Application initialized successfully.')}`);
    }
  } catch (error) {
    console.error(
      'Error loading runtime:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

function countResources(kernel: Kernel): number {
  let count = 0;
  for (const kindMap of kernel.registry.values()) {
    count += kindMap.size;
  }
  return count;
}

function getKinds(kernel: Kernel): string[] {
  return Array.from(kernel.registry.keys()).sort();
}

function suppressDebugLogs(): void {
  const originalLog = console.log.bind(console);
  console.log = (...args: any[]) => {
    if (args.length === 0) {
      return;
    }
    const first = String(args[0]);
    if (first.startsWith('DEBUG:')) {
      return;
    }
    if (first.includes('No resources specified in runtime.yaml')) {
      return;
    }
    if (first.includes(': Loaded ') && first.includes(' resources')) {
      return;
    }
    originalLog(...args);
  };
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

async function startModules(
  kernel: Kernel,
  log: ReturnType<typeof createLogger>,
) {
  const errors: Error[] = [];
  const modules = Array.from(kernel.moduleInstances.values());
  if (modules.length === 0) {
    log.info(log.warn('No modules registered.'));
    return errors;
  }

  try {
    await kernel.start();
    // for (const module of modules) {
    //   log.info(`${log.ok('✓')} ${module.name}`);
    // }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.info(`${log.error('✗')} ${message}`);
    errors.push(error instanceof Error ? error : new Error(message));
  }

  if (errors.length === 0) {
    const payload = { kernel, config: kernel.getRuntimeConfig() || {} };
    await kernel.waitForIdle();
    await kernel.emitRuntimeEvent('Runtime.Stopping', payload);
    await kernel.teardownResources();
    await kernel.emitRuntimeEvent('Runtime.Stopped', payload);
    process.exit(0);
  }

  return errors;
}

function registerSignalHandlers(
  kernel: Kernel,
  log: ReturnType<typeof createLogger>,
) {
  let shuttingDown = false;
  const handler = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      const payload = { kernel, config: kernel.getRuntimeConfig() || {} };
      await kernel.emitRuntimeEvent('Runtime.Stopping', payload);
      await kernel.teardownResources();
      await kernel.emitRuntimeEvent('Runtime.Stopped', payload);
      log.info(log.dim('Shutdown complete.'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.info(log.error(`Shutdown error: ${message}`));
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);

  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
