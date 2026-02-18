/**
 * Tests for doc-draft-workflow template structure.
 * Covers: param resolution, conditional validators, trigger logic, hook wiring.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const TemplateResolver = require('../src/template-resolver');

describe('Doc Draft Workflow — Template Resolution', function () {
  let resolver;

  before(function () {
    const templatesDir = path.join(__dirname, '..', 'cluster-templates');
    resolver = new TemplateResolver(templatesDir);
  });

  function baseParams(overrides = {}) {
    return {
      tier: 'lens',
      drafter_level: 'level2',
      validator_count: 2,
      max_iterations: 4,
      max_tokens: 150000,
      has_action_items: false,
      ...overrides,
    };
  }

  function resolveWorkflow(overrides = {}) {
    return resolver.resolve('doc-draft-workflow', baseParams(overrides));
  }

  function getValidatorIds(resolved) {
    return resolved.agents
      .filter((a) => a.role === 'validator')
      .map((a) => a.id)
      .sort();
  }

  // --- Validator activation matrix ---

  describe('Validator activation matrix', function () {
    it('facet tier — only completeness validator', function () {
      const resolved = resolveWorkflow({
        tier: 'facet',
        validator_count: 1,
        max_iterations: 3,
        max_tokens: 100000,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-completeness']);
    });

    it('facet tier + has_action_items — completeness only (actionability needs validator_count >= 2)', function () {
      const resolved = resolveWorkflow({
        tier: 'facet',
        validator_count: 1,
        has_action_items: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-completeness']);
    });

    it('lens tier — completeness + accuracy', function () {
      const resolved = resolveWorkflow({
        tier: 'lens',
        validator_count: 2,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-accuracy', 'validator-completeness']);
    });

    it('lens tier + has_action_items — completeness + accuracy + actionability', function () {
      const resolved = resolveWorkflow({
        tier: 'lens',
        validator_count: 2,
        has_action_items: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, [
        'validator-accuracy',
        'validator-actionability',
        'validator-completeness',
      ]);
    });

    it('prism tier — completeness + accuracy + coherence', function () {
      const resolved = resolveWorkflow({
        tier: 'prism',
        drafter_level: 'level3',
        validator_count: 3,
        max_iterations: 5,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, [
        'validator-accuracy',
        'validator-coherence',
        'validator-completeness',
      ]);
    });

    it('prism tier + has_action_items — all four validators', function () {
      const resolved = resolveWorkflow({
        tier: 'prism',
        drafter_level: 'level3',
        validator_count: 3,
        max_iterations: 5,
        has_action_items: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, [
        'validator-accuracy',
        'validator-actionability',
        'validator-coherence',
        'validator-completeness',
      ]);
    });
  });

  // --- Agent configuration ---

  describe('Agent configuration', function () {
    it('drafter has role: implementation', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.strictEqual(drafter.role, 'implementation');
    });

    it('drafter uses Claude CLI (useDirectApi: false)', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.strictEqual(drafter.useDirectApi, false);
    });

    it('completeness validator uses Claude CLI (useDirectApi: false)', function () {
      const resolved = resolveWorkflow();
      const v = resolved.agents.find((a) => a.id === 'validator-completeness');
      assert.strictEqual(v.useDirectApi, false);
    });

    it('accuracy validator uses Claude CLI (useDirectApi: false)', function () {
      const resolved = resolveWorkflow();
      const v = resolved.agents.find((a) => a.id === 'validator-accuracy');
      assert.strictEqual(v.useDirectApi, false);
    });

    it('coherence validator uses direct API (useDirectApi: true)', function () {
      const resolved = resolveWorkflow({ validator_count: 3 });
      const v = resolved.agents.find((a) => a.id === 'validator-coherence');
      assert.strictEqual(v.useDirectApi, true);
    });

    it('actionability validator uses direct API (useDirectApi: true)', function () {
      const resolved = resolveWorkflow({ validator_count: 2, has_action_items: true });
      const v = resolved.agents.find((a) => a.id === 'validator-actionability');
      assert.strictEqual(v.useDirectApi, true);
    });

    it('revision-preparer has role: orchestrator', function () {
      const resolved = resolveWorkflow();
      const rp = resolved.agents.find((a) => a.id === 'revision-preparer');
      assert.strictEqual(rp.role, 'orchestrator');
    });

    it('completion-detector has role: orchestrator', function () {
      const resolved = resolveWorkflow();
      const cd = resolved.agents.find((a) => a.id === 'completion-detector');
      assert.strictEqual(cd.role, 'orchestrator');
    });

    it('drafter maxIterations resolves from params', function () {
      const resolved = resolveWorkflow({ max_iterations: 5 });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.strictEqual(drafter.maxIterations, 5);
    });
  });

  // --- Trigger wiring ---

  describe('Trigger wiring', function () {
    it('drafter triggers on ISSUE_OPENED', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      const trigger = drafter.triggers.find((t) => t.topic === 'ISSUE_OPENED');
      assert.ok(trigger, 'Drafter should trigger on ISSUE_OPENED');
      assert.strictEqual(trigger.action, 'execute_task');
    });

    it('drafter triggers on REVISION_CONTEXT', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      const trigger = drafter.triggers.find((t) => t.topic === 'REVISION_CONTEXT');
      assert.ok(trigger, 'Drafter should trigger on REVISION_CONTEXT');
      assert.strictEqual(trigger.action, 'execute_task');
    });

    it('all validators trigger on DRAFT_READY', function () {
      const resolved = resolveWorkflow({ validator_count: 3, has_action_items: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const trigger = v.triggers.find((t) => t.topic === 'DRAFT_READY');
        assert.ok(trigger, `${v.id} should trigger on DRAFT_READY`);
      }
    });

    it('revision-preparer triggers on VALIDATION_RESULT with logic', function () {
      const resolved = resolveWorkflow();
      const rp = resolved.agents.find((a) => a.id === 'revision-preparer');
      const trigger = rp.triggers[0];
      assert.strictEqual(trigger.topic, 'VALIDATION_RESULT');
      assert.ok(trigger.logic, 'Should have trigger logic');
      assert.strictEqual(trigger.action, 'execute_system_command');
    });

    it('completion-detector triggers on VALIDATION_RESULT with logic', function () {
      const resolved = resolveWorkflow();
      const cd = resolved.agents.find((a) => a.id === 'completion-detector');
      const trigger = cd.triggers[0];
      assert.strictEqual(trigger.topic, 'VALIDATION_RESULT');
      assert.ok(trigger.logic, 'Should have trigger logic');
      assert.strictEqual(trigger.action, 'execute_system_command');
      assert.strictEqual(trigger.config.stopClusterAfter, true);
    });
  });

  // --- Hook wiring ---

  describe('Hook wiring', function () {
    it('drafter publishes to DRAFT_READY', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.strictEqual(drafter.hooks.onComplete.config.topic, 'DRAFT_READY');
    });

    it('drafter error hook publishes to DRAFT_READY', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.strictEqual(drafter.hooks.onError.config.topic, 'DRAFT_READY');
    });

    it('all validators publish to VALIDATION_RESULT via transform', function () {
      const resolved = resolveWorkflow({ validator_count: 3, has_action_items: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const script = v.hooks.onComplete.transform.script;
        assert.ok(
          script.includes("'VALIDATION_RESULT'"),
          `${v.id} transform should target VALIDATION_RESULT`
        );
      }
    });

    it('all validators auto-reject on error', function () {
      const resolved = resolveWorkflow({ validator_count: 3, has_action_items: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const errorData = v.hooks.onError.config.content.data;
        assert.strictEqual(errorData.approved, false);
        assert.ok(errorData.validatorError);
      }
    });

    it('validator transforms compute approved from sectionReviews (ACCEPT + APPROVE_WITH_NOTES)', function () {
      const resolved = resolveWorkflow({ validator_count: 3, has_action_items: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const script = v.hooks.onComplete.transform.script;
        assert.ok(script.includes('sectionReviews'), `${v.id} transform should use sectionReviews`);
        assert.ok(
          script.includes('APPROVE_WITH_NOTES'),
          `${v.id} transform should check for APPROVE_WITH_NOTES`
        );
      }
    });

    it('revision-preparer runs build-revision-context.js', function () {
      const resolved = resolveWorkflow();
      const rp = resolved.agents.find((a) => a.id === 'revision-preparer');
      const command = rp.triggers[0].config.command;
      assert.ok(command.includes('build-revision-context.js'));
    });

    it('completion-detector runs assemble-doc.js', function () {
      const resolved = resolveWorkflow();
      const cd = resolved.agents.find((a) => a.id === 'completion-detector');
      const command = cd.triggers[0].config.command;
      assert.ok(command.includes('assemble-doc.js'));
    });
  });

  // --- Prompt rendering ---

  describe('Drafter prompt rendering', function () {
    it('facet tier renders correct perspective count', function () {
      const resolved = resolveWorkflow({ tier: 'facet', validator_count: 1, max_iterations: 3 });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(drafter.prompt.initial.includes('FACET tier'));
      assert.ok(drafter.prompt.initial.includes('2-3 perspectives'));
    });

    it('lens tier renders correct perspective count', function () {
      const resolved = resolveWorkflow({ tier: 'lens' });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(drafter.prompt.initial.includes('LENS tier'));
      assert.ok(drafter.prompt.initial.includes('3-5 perspectives'));
    });

    it('prism tier renders correct perspective count', function () {
      const resolved = resolveWorkflow({
        tier: 'prism',
        drafter_level: 'level3',
        validator_count: 3,
      });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(drafter.prompt.initial.includes('PRISM tier'));
      assert.ok(drafter.prompt.initial.includes('5-8 perspectives'));
    });

    it('prism prompt uses batched spawning, not single-message', function () {
      const resolved = resolveWorkflow({
        tier: 'prism',
        drafter_level: 'level3',
        validator_count: 3,
      });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(
        drafter.prompt.initial.includes('BATCHES of at most 4'),
        'Prism initial prompt should include batching guidance'
      );
      assert.ok(
        !drafter.prompt.initial.includes('Spawn ALL in a SINGLE message'),
        'Prism initial prompt should NOT include single-message spawning'
      );
    });

    it('prism subsequent prompt includes batching guidance', function () {
      const resolved = resolveWorkflow({
        tier: 'prism',
        drafter_level: 'level3',
        validator_count: 3,
      });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(
        drafter.prompt.subsequent.includes('at most 4 per message'),
        'Prism subsequent prompt should include batching guidance for revisions'
      );
    });

    it('subagent prompt template includes terseness guidance', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(
        drafter.prompt.initial.includes('high information density'),
        'Subagent template should include terseness guidance'
      );
    });

    it('subsequent prompt references REVISION_CONTEXT', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(drafter.prompt.subsequent.includes('REVISION_CONTEXT'));
      assert.ok(drafter.prompt.subsequent.includes('revisionsNeeded'));
    });
  });

  // --- Default params ---

  describe('Default params', function () {
    it('has_action_items defaults to false', function () {
      const info = resolver.getTemplateInfo('doc-draft-workflow');
      assert.strictEqual(info.params.has_action_items.default, false);
    });

    it('tier defaults to lens', function () {
      const info = resolver.getTemplateInfo('doc-draft-workflow');
      assert.strictEqual(info.params.tier.default, 'lens');
    });

    it('validator_count defaults to 2', function () {
      const info = resolver.getTemplateInfo('doc-draft-workflow');
      assert.strictEqual(info.params.validator_count.default, 2);
    });
  });

  // --- Topic naming ---

  describe('Topic naming (distinct from code workflow)', function () {
    it('uses DRAFT_READY not IMPLEMENTATION_READY', function () {
      const resolved = resolveWorkflow();
      const json = JSON.stringify(resolved);
      assert.ok(json.includes('DRAFT_READY'));
      assert.ok(!json.includes('IMPLEMENTATION_READY'));
    });

    it('uses REVISION_CONTEXT not VALIDATION_RESULT for drafter re-trigger', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      const revisionTrigger = drafter.triggers.find((t) => t.topic === 'REVISION_CONTEXT');
      assert.ok(revisionTrigger, 'Drafter should have REVISION_CONTEXT trigger');
    });

    it('completion-detector logic does NOT reference DOC_COMPLETE (L1 removal)', function () {
      const resolved = resolveWorkflow();
      const cd = resolved.agents.find((a) => a.id === 'completion-detector');
      const script = cd.triggers[0].logic.script;
      assert.ok(
        !script.includes('DOC_COMPLETE'),
        'DOC_COMPLETE is dead code and should be removed'
      );
    });
  });

  // --- C1 fix: revision loop restoration ---

  describe('Revision loop (C1 fix)', function () {
    it('revision-preparer uses trigger.config.onSuccess (not hooks.onComplete) to publish REVISION_CONTEXT', function () {
      const resolved = resolveWorkflow();
      const rp = resolved.agents.find((a) => a.id === 'revision-preparer');

      // Should NOT have hooks.onComplete
      assert.ok(
        !rp.hooks?.onComplete,
        'revision-preparer should not have hooks.onComplete (dead for execute_system_command)'
      );

      // Should have onSuccess in trigger config
      const trigger = rp.triggers[0];
      assert.ok(trigger.config.onSuccess, 'Should have onSuccess in trigger config');
      assert.strictEqual(trigger.config.onSuccess.topic, 'REVISION_CONTEXT');
      assert.strictEqual(trigger.config.onSuccess.contentFromOutput, true);
    });

    it('revision-preparer logic script guards against draftCount >= max_iterations (M3)', function () {
      const resolved = resolveWorkflow({ max_iterations: 4 });
      const rp = resolved.agents.find((a) => a.id === 'revision-preparer');
      const script = rp.triggers[0].logic.script;
      assert.ok(script.includes('draftCount >= 4'), 'Should guard against max_iterations');
      assert.ok(script.includes('return false'), 'Should return false when at max iterations');
    });
  });

  // --- M6 fix: drafter onError ---

  describe('Drafter onError (M6 fix)', function () {
    it('drafter onError sets canValidate: false', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      const errorData = drafter.hooks.onError.config.content.data;
      assert.strictEqual(
        errorData.completionStatus.canValidate,
        false,
        'onError should set canValidate: false to prevent silent approval of empty docs'
      );
    });
  });
});

describe('Direct-Routed Doc Configs — Parameter Validation', function () {
  const templatesDir = path.join(__dirname, '..', 'cluster-templates');

  function readTransformScript(configFile) {
    const config = JSON.parse(fs.readFileSync(path.join(templatesDir, configFile), 'utf8'));
    return config.agents[0].hooks.onComplete.transform.script;
  }

  it('doc-facet sets correct tier params', function () {
    const script = readTransformScript('doc-facet.json');
    assert.ok(script.includes("tier: 'facet'"), 'tier should be facet');
    assert.ok(script.includes("drafter_level: 'level2'"), 'drafter_level should be level2');
    assert.ok(script.includes('validator_count: 1'), 'validator_count should be 1');
    assert.ok(script.includes('max_iterations: 3'), 'max_iterations should be 3');
    assert.ok(script.includes('max_tokens: 100000'), 'max_tokens should be 100000');
    assert.ok(script.includes('has_action_items: false'), 'has_action_items should be false');
  });

  it('doc-lens sets correct tier params', function () {
    const script = readTransformScript('doc-lens.json');
    assert.ok(script.includes("tier: 'lens'"), 'tier should be lens');
    assert.ok(script.includes("drafter_level: 'level2'"), 'drafter_level should be level2');
    assert.ok(script.includes('validator_count: 2'), 'validator_count should be 2');
    assert.ok(script.includes('max_iterations: 4'), 'max_iterations should be 4');
    assert.ok(script.includes('max_tokens: 150000'), 'max_tokens should be 150000');
    assert.ok(script.includes('has_action_items: false'), 'has_action_items should be false');
  });

  it('doc-prism sets correct tier params', function () {
    const script = readTransformScript('doc-prism.json');
    assert.ok(script.includes("tier: 'prism'"), 'tier should be prism');
    assert.ok(script.includes("drafter_level: 'level3'"), 'drafter_level should be level3');
    assert.ok(script.includes('validator_count: 3'), 'validator_count should be 3');
    assert.ok(script.includes('max_iterations: 5'), 'max_iterations should be 5');
    assert.ok(script.includes('max_tokens: 150000'), 'max_tokens should be 150000');
    assert.ok(script.includes('has_action_items: false'), 'has_action_items should be false');
  });

  it('all router configs use doc-draft-workflow base', function () {
    for (const file of ['doc-facet.json', 'doc-lens.json', 'doc-prism.json']) {
      const script = readTransformScript(file);
      assert.ok(
        script.includes("base: 'doc-draft-workflow'"),
        `${file} should use doc-draft-workflow base`
      );
    }
  });

  it('all router configs republish ISSUE_OPENED', function () {
    for (const file of ['doc-facet.json', 'doc-lens.json', 'doc-prism.json']) {
      const script = readTransformScript(file);
      assert.ok(script.includes("topic: 'ISSUE_OPENED'"), `${file} should republish ISSUE_OPENED`);
      assert.ok(script.includes('_republished: true'), `${file} should set _republished flag`);
    }
  });
});
