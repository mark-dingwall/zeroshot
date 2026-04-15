process.env.ZEROSHOT_SKIP_GH_VERIFY = '1';

/**
 * Regression test for cluster-run processes that never exit after
 * terminal cluster state. Covers the shared `waitForTerminalState`
 * helper and `orchestrator.shutdown()` release path used by both
 * foreground and daemon modes.
 */

const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const Orchestrator = require('../../src/orchestrator');
const MockTaskRunner = require('../helpers/mock-task-runner');

const simpleConfig = {
  agents: [
    {
      id: 'worker',
      role: 'implementation',
      timeout: 0,
      triggers: [{ topic: 'ISSUE_OPENED', action: 'execute_task' }],
      prompt: 'Do the thing',
      hooks: {
        onComplete: {
          action: 'publish_message',
          config: { topic: 'TASK_COMPLETE', content: { text: 'Done' } },
        },
      },
    },
    {
      id: 'completion-detector',
      role: 'orchestrator',
      timeout: 0,
      triggers: [{ topic: 'TASK_COMPLETE', action: 'stop_cluster' }],
    },
  ],
};

function waitForTerminalState(orchestrator, clusterId, intervalMs = 50) {
  return new Promise((resolve) => {
    const intervalId = setInterval(() => {
      try {
        const status = orchestrator.getStatus(clusterId);
        if (status.state !== 'running') {
          clearInterval(intervalId);
          resolve();
        }
      } catch {
        clearInterval(intervalId);
        resolve();
      }
    }, intervalMs);
  });
}

describe('Daemon / foreground exit after terminal state', function () {
  this.timeout(15000);

  let tempDir;
  let orchestrator;
  let mockRunner;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroshot-daemon-exit-'));
    mockRunner = new MockTaskRunner();
    mockRunner.when('worker').returns('{"done": true}');
    orchestrator = new Orchestrator({
      quiet: true,
      storageDir: tempDir,
      taskRunner: mockRunner,
    });
  });

  afterEach(async () => {
    if (orchestrator) {
      const clusters = orchestrator.listClusters();
      for (const cluster of clusters) {
        try {
          await orchestrator.kill(cluster.id);
        } catch {
          // Ignore cleanup errors
        }
      }
      try {
        await orchestrator.shutdown();
      } catch {
        // Already closed
      }
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('waitForTerminalState resolves once cluster reaches stopped', async () => {
    const result = await orchestrator.start(simpleConfig, { text: 'Test' });
    const clusterId = result.id;

    const start = Date.now();
    await waitForTerminalState(orchestrator, clusterId);
    const elapsed = Date.now() - start;

    const status = orchestrator.getStatus(clusterId);
    assert.notStrictEqual(status.state, 'running', 'cluster should have left running');
    assert.ok(elapsed < 10000, `terminal state reached in ${elapsed}ms`);
  });

  it('orchestrator.shutdown() releases message bus / ledger after stop', async () => {
    const result = await orchestrator.start(simpleConfig, { text: 'Test' });
    const clusterId = result.id;
    const cluster = orchestrator.getCluster(clusterId);

    await waitForTerminalState(orchestrator, clusterId);

    assert.strictEqual(cluster.ledger._closed, false, 'ledger open after stop (resume path)');

    await orchestrator.shutdown();

    assert.strictEqual(orchestrator.closed, true, 'closed flag set');
    assert.strictEqual(cluster.ledger._closed, true, 'ledger closed by shutdown');
    const post = cluster.messageBus.publish({
      cluster_id: clusterId,
      topic: 'POST_SHUTDOWN',
      sender: 'test',
    });
    assert.strictEqual(post, null, 'publish after shutdown drops (ledger closed)');
  });

  it('shutdown is idempotent', async () => {
    const result = await orchestrator.start(simpleConfig, { text: 'Test' });
    await waitForTerminalState(orchestrator, result.id);

    await orchestrator.shutdown();
    await orchestrator.shutdown();
  });
});
