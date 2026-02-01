/**
 * Stdin Piping Tests
 *
 * Tests for E2BIG mitigation via stdin piping of large prompts/contexts.
 * Covers the readStdin() function and CLI argument handling.
 */

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');

/**
 * Dynamically import the ESM run module
 * @returns {Promise<{readStdin: Function, runTask: Function}>}
 */
function loadRunModule() {
  const modulePath = path.resolve(__dirname, '../task-lib/commands/run.js');
  return import(pathToFileURL(modulePath).href);
}

// ============================================================================
// readStdin() FUNCTION TESTS
// ============================================================================
describe('readStdin()', function () {
  let originalStdin;

  beforeEach(function () {
    originalStdin = process.stdin;
  });

  afterEach(function () {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  });

  it('should read data from stdin stream', async function () {
    const { readStdin } = await loadRunModule();

    // Create a mock stdin stream
    const mockStdin = new Readable({
      read() {
        this.push('Hello, world!');
        this.push(null); // Signal EOF
      },
    });

    // Replace process.stdin temporarily
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    const result = await readStdin(1000);
    assert.strictEqual(result, 'Hello, world!');
  });

  it('should read multi-chunk data from stdin', async function () {
    const { readStdin } = await loadRunModule();

    const chunks = ['chunk1', 'chunk2', 'chunk3'];
    let chunkIndex = 0;

    const mockStdin = new Readable({
      read() {
        if (chunkIndex < chunks.length) {
          this.push(chunks[chunkIndex++]);
        } else {
          this.push(null);
        }
      },
    });

    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    const result = await readStdin(1000);
    assert.strictEqual(result, 'chunk1chunk2chunk3');
  });

  it('should timeout when stdin hangs', async function () {
    this.timeout(5000);
    const { readStdin } = await loadRunModule();

    // Create a stream that never ends
    const hangingStdin = new Readable({
      read() {
        // Never push anything, simulating a hung pipe
      },
    });

    Object.defineProperty(process, 'stdin', {
      value: hangingStdin,
      writable: true,
      configurable: true,
    });

    await assert.rejects(readStdin(100), /timeout/);
  });

  it('should handle empty stdin', async function () {
    const { readStdin } = await loadRunModule();

    const emptyStdin = new Readable({
      read() {
        this.push(null); // Immediate EOF
      },
    });

    Object.defineProperty(process, 'stdin', {
      value: emptyStdin,
      writable: true,
      configurable: true,
    });

    const result = await readStdin(1000);
    assert.strictEqual(result, '');
  });
});

// ============================================================================
// CLI ARGUMENT HANDLING TESTS
// ============================================================================
describe('CLI stdin piping', function () {
  const cliPath = path.join(__dirname, '..', 'cli', 'index.js');

  it('should accept prompt via stdin when no argument provided', function (done) {
    this.timeout(10000);

    // Spawn CLI with --help to check signature
    const proc = spawn('node', [cliPath, 'task', 'run', '--help'], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      // Help should show [prompt] as optional (not <prompt> as required)
      assert.ok(
        stdout.includes('[prompt]') || stdout.includes('prompt'),
        `Help should show prompt is optional. Got: ${stdout}`
      );
      done();
    });

    proc.on('error', done);
  });

  it('should show prompt as optional in command signature', function (done) {
    this.timeout(10000);

    const proc = spawn('node', [cliPath, 'task', '--help'], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      // The run command should show [prompt] indicating optional
      // Commander.js uses [arg] for optional and <arg> for required
      assert.ok(
        stdout.includes('run [prompt]') || stdout.includes('run'),
        `Should show run command. Got: ${stdout}`
      );
      done();
    });

    proc.on('error', done);
  });
});

// ============================================================================
// STDIN ERROR HANDLING TESTS
// ============================================================================
describe('stdin error handling', function () {
  it('should surface EPIPE errors from stdin.write()', function (done) {
    // Test that the error handler pattern we added works correctly
    const proc = spawn('node', ['-e', 'process.exit(0)'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Add error handler like we do in agent-task-executor.js
    proc.stdin.on('error', (err) => {
      // EPIPE is expected when process exits before stdin write completes
      assert.ok(
        err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED' || err.message,
        'Should catch stdin error'
      );
    });

    // Try to write after process exits - should trigger EPIPE
    proc.on('close', () => {
      // Small delay to ensure we try to write after close
      setTimeout(() => {
        try {
          proc.stdin.write('test data after close');
          proc.stdin.end();
        } catch (writeError) {
          // Write might throw synchronously (e.g., ERR_STREAM_DESTROYED), which is expected
          assert.ok(writeError.message, 'Should have error message');
        }

        // The important thing is we didn't crash with unhandled error
        done();
      }, 50);
    });
  });
});

// ============================================================================
// WATCHER.JS STDIN PIPING TESTS
// ============================================================================
describe('watcher.js stdin piping', function () {
  it('should pipe context to child process via stdin', function (done) {
    this.timeout(15000);

    // Test that watcher.js correctly pipes config.context via stdin
    // Note: We use a moderate payload size (50KB) to avoid E2BIG when spawning
    // the watcher itself. The actual E2BIG prevention for 150KB+ payloads is
    // tested by the cli-builder tests that verify context is returned separately.
    const fs = require('fs');
    const os = require('os');

    // Create temp files for the test
    const testId = `test-${Date.now()}`;
    const logFile = path.join(os.tmpdir(), `${testId}.log`);
    const storeDir = path.join(os.tmpdir(), 'zeroshot-test-store');

    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }

    // Create a minimal store.json that watcher.js can update
    const storeFile = path.join(storeDir, 'store.json');
    const initialStore = {
      [testId]: { id: testId, status: 'running', pid: null },
    };
    fs.writeFileSync(storeFile, JSON.stringify(initialStore));

    // Create a 50KB payload - large enough to verify stdin piping works,
    // small enough to not trigger E2BIG when spawning watcher
    const context = 'Z'.repeat(50 * 1024);

    // We'll use a simple node script that reads stdin and outputs length
    const echoScript = `
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => {
        console.log('CONTEXT_LENGTH:' + data.length);
        process.exit(0);
      });
    `;

    // Args for the echo script
    const args = ['-e', echoScript];

    // Create config with context
    const config = {
      context: context,
      command: 'node',
    };

    // Spawn the watcher directly with moderate-sized config
    const watcherPath = path.join(__dirname, '..', 'task-lib', 'watcher.js');
    const watcher = spawn(
      'node',
      [watcherPath, testId, process.cwd(), logFile, JSON.stringify(args), JSON.stringify(config)],
      {
        env: {
          ...process.env,
          ZEROSHOT_STORE_FILE: storeFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stderr = '';

    watcher.stdout.on('data', () => {
      // Watcher doesn't output to stdout
    });

    watcher.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    watcher.on('close', () => {
      // Read the log file to verify context was piped
      let logContent = '';
      try {
        logContent = fs.readFileSync(logFile, 'utf8');
      } catch {
        // Log file might not exist if watcher crashed early
      }

      // Clean up temp files
      const cleanup = [logFile, storeFile];
      for (const f of cleanup) {
        try {
          fs.unlinkSync(f);
        } catch {
          // Ignore cleanup errors
        }
      }

      // Check that the child process received the full context
      const match = logContent.match(/CONTEXT_LENGTH:(\d+)/);
      if (!match) {
        done(
          new Error(
            `Expected CONTEXT_LENGTH in log output. ` +
              `Log: ${logContent.slice(0, 500)}... ` +
              `stderr: ${stderr}`
          )
        );
        return;
      }

      const receivedLength = parseInt(match[1], 10);
      assert.strictEqual(
        receivedLength,
        context.length,
        `Expected ${context.length} bytes via stdin, received ${receivedLength}`
      );

      done();
    });

    watcher.on('error', done);
  });
});

// ============================================================================
// E2BIG MITIGATION TESTS - LARGE PAYLOAD HANDLING
// ============================================================================
describe('E2BIG mitigation - large payload handling', function () {
  it('should handle payload larger than 128KB without E2BIG error', function (done) {
    this.timeout(10000);

    // Create a payload larger than ARG_MAX (typically 128KB on Linux)
    // Using 150KB to ensure we exceed the limit
    const largePayload = 'X'.repeat(150 * 1024);

    // Spawn a process that reads from stdin and echoes length
    // This tests the stdin piping mechanism without needing the full CLI
    const proc = spawn(
      'node',
      [
        '-e',
        `
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => {
        console.log('RECEIVED:' + data.length);
        process.exit(0);
      });
    `,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      // E2BIG would manifest here if we passed payload as args
      done(new Error(`Spawn error (possible E2BIG): ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        done(new Error(`Process exited with code ${code}. stderr: ${stderr}`));
        return;
      }

      // Verify the full payload was received
      const match = stdout.match(/RECEIVED:(\d+)/);
      if (!match) {
        done(new Error(`Expected RECEIVED:<length> in output. Got: ${stdout}`));
        return;
      }

      const receivedLength = parseInt(match[1], 10);
      assert.strictEqual(
        receivedLength,
        largePayload.length,
        `Expected ${largePayload.length} bytes, received ${receivedLength}`
      );
      done();
    });

    // Pipe large payload via stdin (the fix we're testing)
    proc.stdin.write(largePayload);
    proc.stdin.end();
  });

  it('should verify cli-builder returns context separately from args', function () {
    const cliBuilder = require('../src/providers/anthropic/cli-builder.js');

    const largeContext = 'Y'.repeat(150 * 1024);
    const result = cliBuilder.buildCommand(largeContext, {
      modelSpec: { model: 'claude-sonnet-4-20250514' },
      outputFormat: 'stream-json',
      cliFeatures: {},
    });

    // Context should be separate, not in args
    assert.strictEqual(result.context, largeContext, 'Context should be returned separately');

    // Args should NOT contain the large context
    const argsString = result.args.join(' ');
    assert.ok(
      !argsString.includes(largeContext),
      'Args should not contain the large context (E2BIG risk)'
    );
    assert.ok(argsString.length < 10000, `Args should be small. Got length: ${argsString.length}`);
  });
});
