import chalk from 'chalk';
import { spawnTask } from '../runner.js';

/**
 * Read all data from stdin until EOF
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<string>} The data read from stdin
 * @throws {Error} If stdin read times out
 */
function readStdin(timeoutMs = parseInt(process.env.ZEROSHOT_STDIN_TIMEOUT, 10) || 30000) {
  const chunks = [];
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const partialBytes = chunks.reduce((acc, c) => acc + c.length, 0);
      process.stdin.destroy();
      reject(
        new Error(
          `stdin read timeout after ${timeoutMs}ms (received ${partialBytes} bytes). ` +
            `Consider increasing ZEROSHOT_STDIN_TIMEOUT.`
        )
      );
    }, timeoutMs);
  });

  const readPromise = (async () => {
    try {
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

export async function runTask(prompt, options = {}) {
  // If no prompt provided, read from stdin (enables piping large prompts)
  if (!prompt || prompt.trim().length === 0) {
    if (process.stdin.isTTY) {
      console.log(chalk.red('Error: Prompt is required (provide as argument or pipe via stdin)'));
      process.exit(1);
    }
    prompt = await readStdin();
    if (!prompt || prompt.trim().length === 0) {
      console.log(chalk.red('Error: No prompt provided via stdin'));
      process.exit(1);
    }
  }

  const outputFormat = options.outputFormat || 'stream-json';
  const jsonSchema = options.jsonSchema;
  const silentJsonOutput = options.silentJsonOutput || false;

  console.log(chalk.dim('Spawning task...'));
  if (options.provider) {
    console.log(chalk.dim(`  Provider: ${options.provider}`));
  }
  if (options.model) {
    console.log(chalk.dim(`  Model: ${options.model}`));
  }
  if (options.modelLevel) {
    console.log(chalk.dim(`  Level: ${options.modelLevel}`));
  }
  if (jsonSchema && outputFormat === 'json') {
    console.log(chalk.dim(`  JSON Schema: enforced`));
    if (silentJsonOutput) {
      console.log(chalk.dim(`  Silent mode: log contains ONLY final JSON`));
    }
  }

  const task = await spawnTask(prompt, {
    cwd: options.cwd || process.cwd(),
    model: options.model,
    modelLevel: options.modelLevel,
    reasoningEffort: options.reasoningEffort,
    provider: options.provider,
    resume: options.resume,
    continue: options.continue,
    outputFormat,
    jsonSchema,
    silentJsonOutput,
  });

  console.log(chalk.green(`\n✓ Task spawned: ${chalk.cyan(task.id)}`));
  console.log(chalk.dim(`  Log: ${task.logFile}`));
  console.log(chalk.dim(`  CWD: ${task.cwd}`));

  console.log(chalk.dim('\nCommands:'));
  console.log(chalk.dim(`  zeroshot attach ${task.id}    # Attach to task (Ctrl+B d to detach)`));
  console.log(chalk.dim(`  zeroshot logs ${task.id}      # View output`));
  console.log(chalk.dim(`  zeroshot logs -f ${task.id}   # Follow output`));
  console.log(chalk.dim(`  zeroshot status ${task.id}    # Check status`));
  console.log(chalk.dim(`  zeroshot kill ${task.id}      # Stop task`));
  console.log();

  return task;
}

// Export readStdin for testing
export { readStdin };
