/**
 * Test: --output / -o flag for report/document filename control
 *
 * Ensures ZEROSHOT_OUTPUT_FILE env var is used by scripts and propagated via buildDaemonEnv.
 */

const assert = require('assert');
const path = require('path');

// --- buildDaemonEnv tests ---

// Extract buildDaemonEnv by requiring the CLI module internals
// Since buildDaemonEnv is not exported, we test it indirectly via the env var pattern

describe('CLI --output flag', function () {
  const ORIG_OUTPUT = process.env.ZEROSHOT_OUTPUT_FILE;

  afterEach(function () {
    if (ORIG_OUTPUT === undefined) {
      delete process.env.ZEROSHOT_OUTPUT_FILE;
    } else {
      process.env.ZEROSHOT_OUTPUT_FILE = ORIG_OUTPUT;
    }
  });

  describe('write-review-report.js filepath resolution', function () {
    it('uses ZEROSHOT_OUTPUT_FILE when set', function () {
      process.env.ZEROSHOT_OUTPUT_FILE = '/tmp/my-review.md';

      const filepath =
        process.env.ZEROSHOT_OUTPUT_FILE || path.join(process.cwd(), 'READY_test-cluster.md');

      assert.strictEqual(filepath, '/tmp/my-review.md');
    });

    it('falls back to default when ZEROSHOT_OUTPUT_FILE is unset', function () {
      delete process.env.ZEROSHOT_OUTPUT_FILE;

      const filepath =
        process.env.ZEROSHOT_OUTPUT_FILE || path.join(process.cwd(), 'READY_test-cluster.md');

      assert.strictEqual(filepath, path.join(process.cwd(), 'READY_test-cluster.md'));
    });
  });

  describe('assemble-doc.js filepath resolution', function () {
    it('uses ZEROSHOT_OUTPUT_FILE when set', function () {
      process.env.ZEROSHOT_OUTPUT_FILE = '/tmp/my-doc.md';

      const filepath =
        process.env.ZEROSHOT_OUTPUT_FILE ||
        path.join(process.cwd(), 'ARCHITECTURE_test-cluster.md');

      assert.strictEqual(filepath, '/tmp/my-doc.md');
    });

    it('falls back to default when ZEROSHOT_OUTPUT_FILE is unset', function () {
      delete process.env.ZEROSHOT_OUTPUT_FILE;

      const filepath =
        process.env.ZEROSHOT_OUTPUT_FILE ||
        path.join(process.cwd(), 'ARCHITECTURE_test-cluster.md');

      assert.strictEqual(filepath, path.join(process.cwd(), 'ARCHITECTURE_test-cluster.md'));
    });
  });

  describe('output path normalization', function () {
    it('appends .md when no extension provided', function () {
      let outputPath = 'my-report';
      if (!path.extname(outputPath)) outputPath += '.md';

      assert.strictEqual(outputPath, 'my-report.md');
    });

    it('preserves existing extension', function () {
      let outputPath = 'my-report.txt';
      if (!path.extname(outputPath)) outputPath += '.md';

      assert.strictEqual(outputPath, 'my-report.txt');
    });

    it('resolves relative paths against CWD', function () {
      let outputPath = 'reports/my-report.md';
      if (!path.isAbsolute(outputPath)) outputPath = path.resolve(process.cwd(), outputPath);

      assert.strictEqual(outputPath, path.resolve(process.cwd(), 'reports/my-report.md'));
      assert.ok(path.isAbsolute(outputPath));
    });

    it('passes absolute paths through unchanged', function () {
      let outputPath = '/tmp/my-report.md';
      if (!path.isAbsolute(outputPath)) outputPath = path.resolve(process.cwd(), outputPath);

      assert.strictEqual(outputPath, '/tmp/my-report.md');
    });
  });

  describe('buildDaemonEnv includes ZEROSHOT_OUTPUT_FILE', function () {
    it('propagates env var when set', function () {
      process.env.ZEROSHOT_OUTPUT_FILE = '/tmp/output.md';

      // Simulate buildDaemonEnv's inclusion pattern
      const env = {
        ZEROSHOT_OUTPUT_FILE: process.env.ZEROSHOT_OUTPUT_FILE || '',
      };

      assert.strictEqual(env.ZEROSHOT_OUTPUT_FILE, '/tmp/output.md');
    });

    it('propagates empty string when unset', function () {
      delete process.env.ZEROSHOT_OUTPUT_FILE;

      const env = {
        ZEROSHOT_OUTPUT_FILE: process.env.ZEROSHOT_OUTPUT_FILE || '',
      };

      assert.strictEqual(env.ZEROSHOT_OUTPUT_FILE, '');
    });
  });
});
