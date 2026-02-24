/**
 * Tests for lib/project-config.js — per-project config CRUD in ~/.zeroshot/projects/.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('project-config', function () {
  let tmpDir;
  let originalEnv;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-test-'));
    originalEnv = process.env.ZEROSHOT_PROJECTS_DIR;
    process.env.ZEROSHOT_PROJECTS_DIR = path.join(tmpDir, 'projects');
    // Clear require cache so module picks up new env var
    delete require.cache[require.resolve('../lib/project-config')];
  });

  afterEach(function () {
    if (originalEnv === undefined) {
      delete process.env.ZEROSHOT_PROJECTS_DIR;
    } else {
      process.env.ZEROSHOT_PROJECTS_DIR = originalEnv;
    }
    delete require.cache[require.resolve('../lib/project-config')];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getProjectHash', function () {
    it('should return deterministic 12-char hex hash', function () {
      const { getProjectHash } = require('../lib/project-config');
      const hash1 = getProjectHash('/home/user/project');
      const hash2 = getProjectHash('/home/user/project');
      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 12);
      assert.ok(/^[0-9a-f]{12}$/.test(hash1));
    });

    it('should produce different hashes for different paths', function () {
      const { getProjectHash } = require('../lib/project-config');
      const hash1 = getProjectHash('/home/user/project-a');
      const hash2 = getProjectHash('/home/user/project-b');
      assert.notStrictEqual(hash1, hash2);
    });
  });

  describe('loadProjectConfig / saveProjectConfig', function () {
    it('should return null for missing config', function () {
      const { loadProjectConfig } = require('../lib/project-config');
      const result = loadProjectConfig('/nonexistent/path');
      assert.strictEqual(result, null);
    });

    it('should round-trip save and load', function () {
      const { loadProjectConfig, saveProjectConfig } = require('../lib/project-config');
      const projectPath = '/home/user/my-project';
      const config = {
        qualityCommand: 'npm test',
        source: 'heuristic',
        ecosystems: ['node'],
        updatedAt: '2026-02-25T12:00:00.000Z',
      };

      saveProjectConfig(projectPath, config);
      const loaded = loadProjectConfig(projectPath);

      assert.strictEqual(loaded.projectPath, path.resolve(projectPath));
      assert.strictEqual(loaded.qualityCommand, 'npm test');
      assert.strictEqual(loaded.source, 'heuristic');
      assert.deepStrictEqual(loaded.ecosystems, ['node']);
    });

    it('should auto-create directory', function () {
      const { saveProjectConfig } = require('../lib/project-config');
      const projectsDir = path.join(tmpDir, 'projects');
      assert.ok(!fs.existsSync(projectsDir));

      saveProjectConfig('/some/path', { qualityCommand: 'make test' });

      assert.ok(fs.existsSync(projectsDir));
    });

    it('should overwrite existing config', function () {
      const { loadProjectConfig, saveProjectConfig } = require('../lib/project-config');
      const projectPath = '/home/user/my-project';

      saveProjectConfig(projectPath, { qualityCommand: 'npm test', source: 'heuristic' });
      saveProjectConfig(projectPath, { qualityCommand: 'npm run lint && npm test', source: 'llm' });

      const loaded = loadProjectConfig(projectPath);
      assert.strictEqual(loaded.qualityCommand, 'npm run lint && npm test');
      assert.strictEqual(loaded.source, 'llm');
    });
  });

  describe('getProjectConfigPath', function () {
    it('should return path under ZEROSHOT_PROJECTS_DIR', function () {
      const { getProjectConfigPath } = require('../lib/project-config');
      const configPath = getProjectConfigPath('/some/project');
      assert.ok(configPath.startsWith(path.join(tmpDir, 'projects')));
      assert.ok(configPath.endsWith('.json'));
    });
  });
});
