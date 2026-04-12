const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sinon = require('sinon');

const Ledger = require('../../src/ledger');
const MessageBus = require('../../src/message-bus');
const Orchestrator = require('../../src/orchestrator');

describe('Orchestrator max_iterations race condition', function () {
  this.timeout(10_000);

  let tempDir;
  let ledger;
  let messageBus;
  let orchestrator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroshot-max-iter-race-'));
    ledger = new Ledger(path.join(tempDir, 'test.db'));
    messageBus = new MessageBus(ledger);

    orchestrator = new Orchestrator({ quiet: true, skipLoad: true, storageDir: tempDir });
    sinon.stub(orchestrator, '_saveClusters').resolves();
  });

  afterEach(() => {
    sinon.restore();
    if (ledger) ledger.close();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does NOT call stop() immediately on max_iterations', async () => {
    const stopSpy = sinon.stub(orchestrator, 'stop').resolves();
    orchestrator.clusters.set('c1', { state: 'running', agents: [] });
    orchestrator._registerClusterCompletionHandlers(messageBus, 'c1');

    messageBus.publish({
      cluster_id: 'c1',
      topic: 'CLUSTER_FAILED',
      sender: 'analyst',
      content: { data: { reason: 'max_iterations' } },
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stopSpy.called, false, 'stop() should not be called for max_iterations');

    const cluster = orchestrator.clusters.get('c1');
    assert.ok(cluster._maxIterSafetyTimeout, 'safety timeout should be set');

    // Clean up the timer
    clearTimeout(cluster._maxIterSafetyTimeout);
  });

  it('calls stop() immediately for non-max_iterations reasons', async () => {
    const stopSpy = sinon.stub(orchestrator, 'stop').resolves();
    orchestrator.clusters.set('c2', { state: 'running', agents: [] });
    orchestrator._registerClusterCompletionHandlers(messageBus, 'c2');

    messageBus.publish({
      cluster_id: 'c2',
      topic: 'CLUSTER_FAILED',
      sender: 'worker',
      content: { data: { reason: 'agent_crash' } },
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stopSpy.calledOnce, true);
    assert.equal(stopSpy.firstCall.args[0], 'c2');
  });

  it('safety timeout fires stop() if CLUSTER_COMPLETE never arrives', () => {
    // Capture the setTimeout callback instead of using fake timers
    // (fake timers interfere with SQLite/EventEmitter in the message bus)
    let capturedCallback;
    const originalSetTimeout = global.setTimeout;
    const setTimeoutStub = sinon.stub(global, 'setTimeout').callsFake((cb, _ms) => {
      capturedCallback = cb;
      // Return a fake timer ID
      return originalSetTimeout(() => {}, 0);
    });

    const stopSpy = sinon.stub(orchestrator, 'stop').resolves();
    orchestrator.clusters.set('c3', { state: 'running', agents: [] });
    orchestrator._registerClusterCompletionHandlers(messageBus, 'c3');

    messageBus.publish({
      cluster_id: 'c3',
      topic: 'CLUSTER_FAILED',
      sender: 'analyst',
      content: { data: { reason: 'max_iterations' } },
    });

    assert.equal(stopSpy.called, false, 'stop() not called yet');
    assert.ok(capturedCallback, 'setTimeout was called with a callback');

    // Simulate the safety timeout firing
    capturedCallback();

    assert.equal(stopSpy.calledOnce, true, 'stop() called after safety timeout');
    assert.equal(stopSpy.firstCall.args[0], 'c3');

    setTimeoutStub.restore();
  });

  it('CLUSTER_COMPLETE clears the safety timeout', async () => {
    const stopSpy = sinon.stub(orchestrator, 'stop').resolves();
    orchestrator.clusters.set('c4', { state: 'running', agents: [] });
    orchestrator._registerClusterCompletionHandlers(messageBus, 'c4');

    // Trigger max_iterations — sets safety timeout
    messageBus.publish({
      cluster_id: 'c4',
      topic: 'CLUSTER_FAILED',
      sender: 'analyst',
      content: { data: { reason: 'max_iterations' } },
    });

    await new Promise((r) => setTimeout(r, 10));
    const cluster = orchestrator.clusters.get('c4');
    assert.ok(cluster._maxIterSafetyTimeout, 'safety timeout should be set');

    // Synthesis chain completes — publishes CLUSTER_COMPLETE
    messageBus.publish({
      cluster_id: 'c4',
      topic: 'CLUSTER_COMPLETE',
      sender: 'completion-detector',
      content: { data: { reason: 'synthesis_complete' } },
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(cluster._maxIterSafetyTimeout, null, 'safety timeout should be cleared');
    assert.equal(stopSpy.calledOnce, true, 'stop() called once by CLUSTER_COMPLETE');
    assert.equal(stopSpy.firstCall.args[0], 'c4');
  });

  it('stop() is a no-op when cluster is already stopped', async () => {
    const cluster = {
      state: 'stopped',
      agents: [],
      initCompletePromise: null,
    };
    orchestrator.clusters.set('c5', cluster);

    // Should not throw and should not change state
    await orchestrator.stop('c5');
    assert.equal(cluster.state, 'stopped');
  });

  it('stop() is a no-op when cluster is already stopping', async () => {
    const cluster = {
      state: 'stopping',
      agents: [],
      initCompletePromise: null,
    };
    orchestrator.clusters.set('c6', cluster);

    await orchestrator.stop('c6');
    assert.equal(cluster.state, 'stopping');
  });
});
