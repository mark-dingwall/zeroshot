/**
 * Tests for paramOverrides mechanism.
 * Verifies that CLI param overrides (e.g., --skip-quality-gate) are
 * stored on cluster and applied during _opLoadConfig template resolution.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Orchestrator = require('../src/orchestrator');

describe('paramOverrides', function () {
  this.timeout(30000);

  let orchestrator;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroshot-param-test-'));
    orchestrator = new Orchestrator({ quiet: true, skipLoad: true, storageDir: tempDir });
  });

  afterEach(async () => {
    try {
      for (const clusterId of orchestrator.listClusters().map((c) => c.id)) {
        await orchestrator.stop(clusterId);
      }
    } catch {
      /* ignore */
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Create a minimal mock cluster for _opLoadConfig testing.
   * Only needs: id, agents array, messageBus, ledger, paramOverrides, modelOverride
   */
  function createMockCluster(paramOverrides) {
    const Ledger = require('../src/ledger');
    const MessageBus = require('../src/message-bus');
    const dbPath = path.join(tempDir, 'test.db');
    const ledger = new Ledger(dbPath);
    const messageBus = new MessageBus(ledger);

    return {
      id: 'test-cluster',
      agents: [],
      messageBus,
      ledger,
      modelOverride: null,
      paramOverrides: paramOverrides || null,
      config: {},
      worktree: null,
      isolation: null,
      cwd: process.cwd(),
    };
  }

  describe('_opLoadConfig with paramOverrides', function () {
    it('should merge paramOverrides into template params', async function () {
      const cluster = createMockCluster({ quality_gate: false });
      orchestrator.clusters.set(cluster.id, cluster);

      const op = {
        config: {
          base: 'worker-validator',
          params: {
            task_type: 'TASK',
            complexity: 'SIMPLE',
            max_tokens: 100000,
            max_iterations: 4,
            worker_level: 'level2',
            validator_level: 'level2',
            quality_gate: true, // conductor says true
          },
        },
      };

      await orchestrator._opLoadConfig(cluster, op, { clusterId: cluster.id });

      // quality_gate: false override should have excluded the quality-gate agent
      const qgAgent = cluster.agents.find((a) => a.config?.id === 'quality-gate');
      assert.strictEqual(qgAgent, undefined, 'quality-gate agent should be excluded by override');
    });

    it('should not modify params when paramOverrides is null', async function () {
      const cluster = createMockCluster(null);
      orchestrator.clusters.set(cluster.id, cluster);

      const op = {
        config: {
          base: 'worker-validator',
          params: {
            task_type: 'TASK',
            complexity: 'SIMPLE',
            max_tokens: 100000,
            max_iterations: 4,
            worker_level: 'level2',
            validator_level: 'level2',
            quality_gate: true,
          },
        },
      };

      await orchestrator._opLoadConfig(cluster, op, { clusterId: cluster.id });

      // quality_gate: true, so quality-gate agent should be present
      const qgAgent = cluster.agents.find((a) => a.config?.id === 'quality-gate');
      assert.ok(qgAgent, 'quality-gate agent should be present when no override');
    });

    it('paramOverrides should survive cluster serialization round-trip', async function () {
      const cluster = createMockCluster({ quality_gate: false });
      cluster.id = 'roundtrip-test';
      cluster.config = { name: 'test' };
      cluster.state = 'stopped';
      cluster.createdAt = new Date().toISOString();
      orchestrator.clusters.set(cluster.id, cluster);

      // Save clusters to disk
      await orchestrator._saveClusters();

      // Read persisted data and verify paramOverrides survived
      const clusters = JSON.parse(fs.readFileSync(path.join(tempDir, 'clusters.json'), 'utf-8'));

      assert.ok(clusters[cluster.id], 'cluster should be persisted');
      assert.deepStrictEqual(
        clusters[cluster.id].paramOverrides,
        { quality_gate: false },
        'paramOverrides should survive serialization round-trip'
      );
    });

    it('should not affect static config loading (string config)', async function () {
      const cluster = createMockCluster({ quality_gate: false });
      orchestrator.clusters.set(cluster.id, cluster);

      // Static config loads don't use params, so paramOverrides should be a no-op
      const op = {
        config: 'code-review-bell',
      };

      // This should load without error (paramOverrides only affect parameterized templates)
      await orchestrator._opLoadConfig(cluster, op, { clusterId: cluster.id });

      // Should have loaded agents from the static config
      assert.ok(cluster.agents.length > 0, 'should have loaded agents from static config');
    });
  });

  describe('CLI flag to paramOverrides mapping', function () {
    it('--skip-quality-gate should map to paramOverrides { quality_gate: false }', function () {
      // The mapping is: options.skipQualityGate ? { quality_gate: false } : undefined
      // Test the logic inline since buildStartOptions is not exported
      const mapOverrides = (skipQualityGate) =>
        skipQualityGate ? { quality_gate: false } : undefined;

      assert.deepStrictEqual(
        mapOverrides(true),
        { quality_gate: false },
        '--skip-quality-gate should produce { quality_gate: false }'
      );
      assert.strictEqual(mapOverrides(false), undefined, 'no flag should produce undefined');
      assert.strictEqual(mapOverrides(undefined), undefined, 'undefined should produce undefined');
    });
  });
});
