/**
 * Tests for quality gate integration in code-review-workflow template.
 * Verifies that the quality gate agents are conditionally included,
 * analyst triggers gate correctly, and stopper agent is configured.
 */

const assert = require('assert');
const path = require('path');
const vm = require('vm');
const TemplateResolver = require('../src/template-resolver');

describe('quality gate in code-review-workflow', function () {
  let resolver;

  before(function () {
    const templatesDir = path.join(__dirname, '..', 'cluster-templates');
    resolver = new TemplateResolver(templatesDir);
  });

  function resolveCodeReview(paramOverrides = {}) {
    return resolver.resolve('code-review-workflow', {
      tier: 'book',
      analyst_level: 'level2',
      validator_level: 'level2',
      validator_count: 1,
      max_iterations: 4,
      max_tokens: 100000,
      change_scope: 'PATCH',
      risk_domain: 'GENERAL',
      has_security_surface: false,
      has_test_changes: false,
      has_api_changes: false,
      quality_gate: true,
      ...paramOverrides,
    });
  }

  /**
   * Evaluate a template script in a vm sandbox (same approach as LogicEngine).
   * Wraps the script in an IIFE and runs it with the provided context variables.
   */
  function evalScript(script, context) {
    const sandbox = { ...context };
    vm.createContext(sandbox);
    const wrapped = `(function() { 'use strict'; ${script} })()`;
    return vm.runInContext(wrapped, sandbox, { timeout: 5000 });
  }

  it('should default quality_gate to true', function () {
    const info = resolver.getTemplateInfo('code-review-workflow');
    assert.strictEqual(info.params.quality_gate.default, true);
  });

  it('should include quality-gate and quality-gate-stopper agents when quality_gate is true', function () {
    const resolved = resolveCodeReview({ quality_gate: true });

    const qg = resolved.agents.find((a) => a.id === 'quality-gate');
    const stopper = resolved.agents.find((a) => a.id === 'quality-gate-stopper');

    assert.ok(qg, 'quality-gate agent should be present');
    assert.ok(stopper, 'quality-gate-stopper agent should be present');
  });

  it('should exclude quality-gate and quality-gate-stopper agents when quality_gate is false', function () {
    const resolved = resolveCodeReview({ quality_gate: false });

    const qg = resolved.agents.find((a) => a.id === 'quality-gate');
    const stopper = resolved.agents.find((a) => a.id === 'quality-gate-stopper');

    assert.strictEqual(qg, undefined, 'quality-gate agent should not be present');
    assert.strictEqual(stopper, undefined, 'quality-gate-stopper agent should not be present');
  });

  it('quality-gate agent should trigger on ISSUE_OPENED with execute_system_command', function () {
    const resolved = resolveCodeReview({ quality_gate: true });
    const qg = resolved.agents.find((a) => a.id === 'quality-gate');

    assert.strictEqual(qg.role, 'quality-gate');
    assert.strictEqual(qg.triggers.length, 1);

    const trigger = qg.triggers[0];
    assert.strictEqual(trigger.topic, 'ISSUE_OPENED');
    assert.strictEqual(trigger.action, 'execute_system_command');
    assert.ok(trigger.config.command.includes('quality-gate-runner.js'));
    assert.strictEqual(trigger.config.onSuccess.topic, 'QUALITY_GATE_PASSED');
    assert.strictEqual(trigger.config.onFailure.topic, 'QUALITY_GATE_FAILED');
  });

  it('quality-gate-stopper should trigger on QUALITY_GATE_FAILED with no onFailure', function () {
    const resolved = resolveCodeReview({ quality_gate: true });
    const stopper = resolved.agents.find((a) => a.id === 'quality-gate-stopper');

    assert.strictEqual(stopper.role, 'orchestrator');
    assert.strictEqual(stopper.triggers.length, 1);

    const trigger = stopper.triggers[0];
    assert.strictEqual(trigger.topic, 'QUALITY_GATE_FAILED');
    assert.strictEqual(trigger.action, 'execute_system_command');
    assert.strictEqual(
      trigger.config.onFailure,
      undefined,
      'stopper should have no onFailure (triggers CLUSTER_FAILED)'
    );
    assert.strictEqual(trigger.config.onSuccess, undefined, 'stopper should have no onSuccess');
  });

  it('analyst should have QUALITY_GATE_PASSED trigger when quality-gate agent exists', function () {
    const resolved = resolveCodeReview({ quality_gate: true });
    const analyst = resolved.agents.find((a) => a.id === 'analyst');

    const qgPassedTrigger = analyst.triggers.find((t) => t.topic === 'QUALITY_GATE_PASSED');
    assert.ok(qgPassedTrigger, 'analyst should have QUALITY_GATE_PASSED trigger');
    assert.strictEqual(qgPassedTrigger.action, 'execute_task');
  });

  it('analyst should have ISSUE_OPENED trigger with logic gate checking for quality-gate role', function () {
    const resolved = resolveCodeReview({ quality_gate: true });
    const analyst = resolved.agents.find((a) => a.id === 'analyst');

    const issueOpenedTrigger = analyst.triggers.find((t) => t.topic === 'ISSUE_OPENED');
    assert.ok(issueOpenedTrigger, 'analyst should have ISSUE_OPENED trigger');
    assert.ok(issueOpenedTrigger.logic, 'ISSUE_OPENED trigger should have logic gate');
    assert.ok(
      issueOpenedTrigger.logic.script.includes('quality-gate'),
      'logic script should check for quality-gate role'
    );
  });

  it('analyst should still have VALIDATION_RESULT trigger for iteration loop', function () {
    const resolved = resolveCodeReview({ quality_gate: true });
    const analyst = resolved.agents.find((a) => a.id === 'analyst');

    const valTrigger = analyst.triggers.find((t) => t.topic === 'VALIDATION_RESULT');
    assert.ok(valTrigger, 'analyst should have VALIDATION_RESULT trigger');
    assert.ok(valTrigger.logic, 'VALIDATION_RESULT trigger should have logic');
  });

  it('analyst should have same trigger structure when quality_gate is false (no quality-gate agent)', function () {
    const resolved = resolveCodeReview({ quality_gate: false });
    const analyst = resolved.agents.find((a) => a.id === 'analyst');

    // ISSUE_OPENED trigger still present with logic gate, but since no quality-gate agent exists,
    // the logic gate will return true (allowing direct fire)
    const issueOpenedTrigger = analyst.triggers.find((t) => t.topic === 'ISSUE_OPENED');
    assert.ok(issueOpenedTrigger, 'analyst should still have ISSUE_OPENED trigger');

    // QUALITY_GATE_PASSED trigger is still in template (harmless, never fires without quality-gate agent)
    const qgPassedTrigger = analyst.triggers.find((t) => t.topic === 'QUALITY_GATE_PASSED');
    assert.ok(
      qgPassedTrigger,
      'QUALITY_GATE_PASSED trigger is still present (harmless without quality-gate agent)'
    );
  });

  describe('analyst ISSUE_OPENED logic gate evaluation', function () {
    it('should return false when quality-gate agent is present', function () {
      const resolved = resolveCodeReview({ quality_gate: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      const trigger = analyst.triggers.find((t) => t.topic === 'ISSUE_OPENED');

      const cluster = {
        getAgents: () => [
          { id: 'analyst', role: 'implementation' },
          { id: 'quality-gate', role: 'quality-gate' },
        ],
      };

      const result = evalScript(trigger.logic.script, { cluster });
      assert.strictEqual(result, false, 'should block analyst when quality-gate agent exists');
    });

    it('should return true when quality-gate agent is absent', function () {
      const resolved = resolveCodeReview({ quality_gate: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      const trigger = analyst.triggers.find((t) => t.topic === 'ISSUE_OPENED');

      const cluster = {
        getAgents: () => [
          { id: 'analyst', role: 'implementation' },
          { id: 'validator-evidence', role: 'validator' },
        ],
      };

      const result = evalScript(trigger.logic.script, { cluster });
      assert.strictEqual(result, true, 'should allow analyst when no quality-gate agent');
    });
  });

  describe('validator 0-findings approval (loop fix)', function () {
    it('should approve when findingReviews is empty (no findings = clean code)', function () {
      const resolved = resolveCodeReview({ quality_gate: true });
      const validator = resolved.agents.find((a) => a.id === 'validator-evidence');
      const script = validator.hooks.onComplete.transform.script;

      const result = { summary: 'No findings to review', findingReviews: [] };
      const output = evalScript(script, { result });

      assert.strictEqual(
        output.content.data.approved,
        true,
        'empty findingReviews should produce approved: true'
      );
      assert.deepStrictEqual(output.content.data.findingReviews, []);
      assert.strictEqual(output.topic, 'VALIDATION_RESULT');
    });

    it('should approve when all findings are accepted', function () {
      const resolved = resolveCodeReview({ quality_gate: true });
      const validator = resolved.agents.find((a) => a.id === 'validator-evidence');
      const script = validator.hooks.onComplete.transform.script;

      const result = {
        summary: 'All accepted',
        findingReviews: [
          { id: 'M1', verdict: 'ACCEPT', reason: 'verified' },
          { id: 'L1', verdict: 'ACCEPT', reason: 'confirmed' },
        ],
      };
      const output = evalScript(script, { result });

      assert.strictEqual(output.content.data.approved, true);
    });

    it('should reject when any finding is rejected', function () {
      const resolved = resolveCodeReview({ quality_gate: true });
      const validator = resolved.agents.find((a) => a.id === 'validator-evidence');
      const script = validator.hooks.onComplete.transform.script;

      const result = {
        summary: 'One rejected',
        findingReviews: [
          { id: 'M1', verdict: 'ACCEPT', reason: 'verified' },
          { id: 'L1', verdict: 'REJECT', reason: 'not found' },
        ],
      };
      const output = evalScript(script, { result });

      assert.strictEqual(output.content.data.approved, false);
    });
  });
});
