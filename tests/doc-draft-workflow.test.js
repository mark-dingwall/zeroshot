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

    it('all validators include STATE_SNAPSHOT at medium priority', function () {
      const resolved = resolveWorkflow({ validator_count: 3, has_action_items: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      assert.strictEqual(validators.length, 4, 'Should have all 4 validators active');
      for (const v of validators) {
        const sources = v.contextStrategy.sources;
        const snapshot = sources.find((s) => s.topic === 'STATE_SNAPSHOT');
        assert.ok(snapshot, `${v.id} should include STATE_SNAPSHOT source`);
        assert.strictEqual(
          snapshot.priority,
          'medium',
          `${v.id} STATE_SNAPSHOT should be medium priority`
        );
        assert.strictEqual(snapshot.strategy, 'latest');
        assert.strictEqual(snapshot.amount, 1);
      }
    });

    it('drafter does NOT include STATE_SNAPSHOT', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      const sources = drafter.contextStrategy.sources;
      const snapshot = sources.find((s) => s.topic === 'STATE_SNAPSHOT');
      assert.ok(!snapshot, 'drafter should not include STATE_SNAPSHOT source');
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
    it('drafter publishes to DRAFT_READY via transform', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      const script = drafter.hooks.onComplete.transform.script;
      assert.ok(script.includes("'DRAFT_READY'"), 'Transform should target DRAFT_READY');
      assert.ok(
        script.includes('ledger.count'),
        'Transform should use ledger.count for iteration detection'
      );
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
      assert.ok(drafter.prompt.initial.includes('FACET:'));
      assert.ok(drafter.prompt.initial.includes('2-3 perspectives'));
    });

    it('lens tier renders correct perspective count', function () {
      const resolved = resolveWorkflow({ tier: 'lens' });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(drafter.prompt.initial.includes('LENS:'));
      assert.ok(drafter.prompt.initial.includes('3-5 perspectives'));
    });

    it('prism tier renders correct perspective count', function () {
      const resolved = resolveWorkflow({
        tier: 'prism',
        drafter_level: 'level3',
        validator_count: 3,
      });
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(drafter.prompt.initial.includes('PRISM:'));
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
        drafter.prompt.initial.includes('max 4 Task calls per message'),
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
        drafter.prompt.subsequent.includes('max 4 per message'),
        'Prism subsequent prompt should include batching guidance for revisions'
      );
    });

    it('subagent prompt template includes terseness guidance', function () {
      const resolved = resolveWorkflow();
      const drafter = resolved.agents.find((a) => a.id === 'drafter');
      assert.ok(
        drafter.prompt.initial.includes('High density'),
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

describe('Doc Draft Workflow — Expanded Document Types', function () {
  let resolver;

  before(function () {
    const templatesDir = path.join(__dirname, '..', 'cluster-templates');
    resolver = new TemplateResolver(templatesDir);
  });

  function resolveWorkflow(overrides = {}) {
    return resolver.resolve('doc-draft-workflow', {
      tier: 'lens',
      drafter_level: 'level2',
      validator_count: 2,
      max_iterations: 4,
      max_tokens: 150000,
      has_action_items: false,
      ...overrides,
    });
  }

  it('drafter jsonSchema enum includes all 9 document types', function () {
    const resolved = resolveWorkflow();
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    const docTypeEnum = drafter.jsonSchema.properties.document.properties.documentType.enum;
    const expected = [
      'CHECKLIST',
      'GUIDE',
      'SPECIFICATION',
      'PLAN',
      'QUESTIONNAIRE',
      'REQUIREMENTS',
      'ACCEPTANCE_CRITERIA',
      'TEST_PLAN',
      'OTHER',
    ];
    assert.deepStrictEqual(docTypeEnum, expected);
  });

  it('drafter prompt contains Questionnaires perspective section', function () {
    const resolved = resolveWorkflow();
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    assert.ok(
      drafter.prompt.initial.includes('Questionnaires:'),
      'Should contain Questionnaires section'
    );
    assert.ok(
      drafter.prompt.initial.includes('Stakeholder Mapper'),
      'Should contain Stakeholder Mapper perspective'
    );
  });

  it('drafter prompt contains Requirements perspective section', function () {
    const resolved = resolveWorkflow();
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    assert.ok(
      drafter.prompt.initial.includes('Requirements:'),
      'Should contain Requirements section'
    );
    assert.ok(
      drafter.prompt.initial.includes('Functional Requirements Analyst'),
      'Should contain Functional Requirements Analyst perspective'
    );
  });

  it('drafter prompt contains Acceptance Criteria perspective section', function () {
    const resolved = resolveWorkflow();
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    assert.ok(
      drafter.prompt.initial.includes('Acceptance Criteria:'),
      'Should contain Acceptance Criteria section'
    );
    assert.ok(
      drafter.prompt.initial.includes('Scenario Writer'),
      'Should contain Scenario Writer perspective'
    );
  });

  it('drafter prompt contains Test Plans perspective section', function () {
    const resolved = resolveWorkflow();
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    assert.ok(drafter.prompt.initial.includes('Test Plans:'), 'Should contain Test Plans section');
    assert.ok(
      drafter.prompt.initial.includes('Coverage Strategist'),
      'Should contain Coverage Strategist perspective'
    );
  });

  it('drafter prompt includes mandatory perspectives directive for has_action_items', function () {
    const resolved = resolveWorkflow({ has_action_items: true });
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    assert.ok(
      drafter.prompt.initial.includes('MANDATORY'),
      'Should contain MANDATORY directive when has_action_items is true'
    );
    assert.ok(
      drafter.prompt.initial.includes('actionable items needing atomic'),
      'Should explain why action perspectives are mandatory'
    );
  });

  it('drafter prompt intro mentions new document types', function () {
    const resolved = resolveWorkflow();
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    assert.ok(
      drafter.prompt.initial.includes('questionnaire'),
      'Should mention questionnaire in document type list'
    );
    assert.ok(
      drafter.prompt.initial.includes('acceptance criteria'),
      'Should mention acceptance criteria in document type list'
    );
    assert.ok(
      drafter.prompt.initial.includes('test plan'),
      'Should mention test plan in document type list'
    );
  });
});

describe('Doc Draft Conductor — Config Validation', function () {
  const templatesDir = path.join(__dirname, '..', 'cluster-templates');
  let conductorConfig;

  before(function () {
    const configPath = path.join(templatesDir, 'doc-draft-conductor.json');
    conductorConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  });

  it('loads without JSON parse errors', function () {
    assert.ok(conductorConfig.name);
    assert.ok(conductorConfig.agents.length === 2);
  });

  it('junior conductor classifies on DocumentIntent x ContentDomain', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    assert.ok(junior, 'Junior conductor exists');
    assert.deepStrictEqual(junior.jsonSchema.properties.documentIntent.enum, [
      'INFORMATIONAL',
      'ACTIONABLE',
      'UNCERTAIN',
    ]);
    assert.deepStrictEqual(junior.jsonSchema.properties.contentDomain.enum, [
      'GENERAL',
      'SENSITIVE',
      'UNCERTAIN',
    ]);
  });

  it('senior conductor has no UNCERTAIN option', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    assert.ok(senior, 'Senior conductor exists');
    assert.deepStrictEqual(senior.jsonSchema.properties.documentIntent.enum, [
      'INFORMATIONAL',
      'ACTIONABLE',
    ]);
    assert.deepStrictEqual(senior.jsonSchema.properties.contentDomain.enum, [
      'GENERAL',
      'SENSITIVE',
    ]);
  });

  it('junior conductor trigger excludes republished messages', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    const trigger = junior.triggers.find((t) => t.topic === 'ISSUE_OPENED');
    assert.ok(trigger.logic, 'Should have logic script');
    assert.ok(trigger.logic.script.includes('!message.metadata?._republished'));
  });

  it('junior transform routes to doc-draft-workflow base', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    const script = junior.hooks.onComplete.transform.script;
    assert.ok(script.includes("base: 'doc-draft-workflow'"));
  });

  it('junior transform derives has_action_items from ACTIONABLE intent', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    const script = junior.hooks.onComplete.transform.script;
    assert.ok(script.includes("documentIntent === 'ACTIONABLE'"));
    assert.ok(script.includes('has_action_items'));
  });

  it('junior transform escalates UNCERTAIN to senior', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    const script = junior.hooks.onComplete.transform.script;
    assert.ok(script.includes("topic: 'CONDUCTOR_ESCALATE'"));
    assert.ok(script.includes("=== 'UNCERTAIN'"));
  });

  it('senior transform routes to doc-draft-workflow base', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    const script = senior.hooks.onComplete.transform.script;
    assert.ok(script.includes("base: 'doc-draft-workflow'"));
  });

  it('senior onError falls back to lens tier with has_action_items: false', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    const script = senior.hooks.onError.transform.script;
    assert.ok(script.includes("tier: 'lens'"), 'Should fall back to lens tier');
    assert.ok(script.includes('has_action_items: false'), 'Should set has_action_items: false');
  });

  it('junior onError is a transform (not static config)', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    assert.ok(junior.hooks.onError.transform, 'Junior onError should use transform');
    assert.ok(!junior.hooks.onError.config, 'Junior onError should not use static config');
  });

  it('junior onError transform accesses ledger for taskText recovery', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    const script = junior.hooks.onError.transform.script;
    assert.ok(script.includes('ledger.findLast'), 'Should use ledger.findLast to recover taskText');
    assert.ok(script.includes('ISSUE_OPENED'), 'Should look up ISSUE_OPENED topic');
  });

  it('senior onError is a transform (not static config)', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    assert.ok(senior.hooks.onError.transform, 'Senior onError should use transform');
    assert.ok(!senior.hooks.onError.config, 'Senior onError should not use static config');
  });

  it('senior onError transform accesses ledger and guards empty taskText', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    const script = senior.hooks.onError.transform.script;
    assert.ok(script.includes('ledger.findLast'), 'Should use ledger.findLast to recover taskText');
    assert.ok(script.includes('throw new Error'), 'Should throw on unrecoverable taskText');
  });

  it('senior onComplete transform uses ledger lookup (not fallback chain)', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    const script = senior.hooks.onComplete.transform.script;
    assert.ok(
      script.includes('ledger.findLast'),
      'Should use ledger.findLast for taskText recovery'
    );
    assert.ok(
      !script.includes('triggeringMessage.content?.data?.taskText'),
      'Should not use old fallback chain path 1'
    );
    assert.ok(
      !script.includes("operations?.find(op => op.action === 'publish')"),
      'Should not use old fallback chain path 3'
    );
  });

  it('senior onComplete transform guards empty taskText', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    const script = senior.hooks.onComplete.transform.script;
    assert.ok(
      script.includes('throw new Error'),
      'Should throw when taskText is empty to prevent drafting from empty brief'
    );
  });

  it('junior uses level1 model, senior uses level2', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    assert.strictEqual(junior.modelLevel, 'level1');
    assert.strictEqual(senior.modelLevel, 'level2');
  });

  it('senior triggers on CONDUCTOR_ESCALATE and CLUSTER_OPERATIONS_VALIDATION_FAILED', function () {
    const senior = conductorConfig.agents.find((a) => a.id === 'senior-doc-conductor');
    const topics = senior.triggers.map((t) => t.topic).sort();
    assert.deepStrictEqual(topics, ['CLUSTER_OPERATIONS_VALIDATION_FAILED', 'CONDUCTOR_ESCALATE']);
  });

  it('junior transform sets correct tier params for each routing combination', function () {
    const junior = conductorConfig.agents.find((a) => a.id === 'junior-doc-conductor');
    const script = junior.hooks.onComplete.transform.script;
    // Verify tier routing logic exists
    assert.ok(script.includes("return 'prism'"), 'ACTIONABLE+SENSITIVE should route to prism');
    assert.ok(script.includes("return 'lens'"), 'Mixed should route to lens');
    assert.ok(script.includes("return 'facet'"), 'INFORMATIONAL+GENERAL should route to facet');
  });
});

describe('Drafter onComplete Transform — Logic Tests', function () {
  const vm = require('vm');
  let transformScript;

  before(function () {
    const templatesDir = path.join(__dirname, '..', 'cluster-templates');
    const resolver = new TemplateResolver(templatesDir);
    const resolved = resolver.resolve('doc-draft-workflow', {
      tier: 'lens',
      drafter_level: 'level2',
      validator_count: 2,
      max_iterations: 4,
      max_tokens: 150000,
      has_action_items: false,
    });
    const drafter = resolved.agents.find((a) => a.id === 'drafter');
    transformScript = drafter.hooks.onComplete.transform.script;
  });

  function runTransform(resultData, ledgerCount) {
    const warnings = [];
    const sandbox = {
      result: resultData,
      ledger: { count: () => ledgerCount },
      console: { warn: (msg) => warnings.push(msg) },
    };
    const ctx = vm.createContext(sandbox);
    ctx.__fn = vm.compileFunction(transformScript, [], { parsingContext: ctx });
    const raw = vm.runInContext('__fn()', ctx, { timeout: 5000 });
    // Roundtrip through JSON to normalize cross-context prototypes for deepStrictEqual
    const returned = JSON.parse(JSON.stringify(raw));
    return { returned, warnings };
  }

  it('iter 1 with document present — normal DRAFT_READY', function () {
    const { returned } = runTransform(
      {
        summary: 'Drafted document',
        completionStatus: { canValidate: true, percentComplete: 100 },
        document: {
          title: 'My Doc',
          documentType: 'GUIDE',
          sections: [{ id: 'I1' }],
          perspectivesUsed: ['Analyst'],
        },
      },
      0
    );
    assert.strictEqual(returned.topic, 'DRAFT_READY');
    assert.strictEqual(returned.content.text, 'Drafted document');
    assert.deepStrictEqual(returned.content.data.document.title, 'My Doc');
    assert.strictEqual(returned.content.data.delta, null);
    assert.strictEqual(returned.content.data.completionStatus.canValidate, true);
  });

  it('iter 1 with document missing — ERROR document', function () {
    const { returned } = runTransform(
      {
        summary: 'Oops',
        completionStatus: { canValidate: true, percentComplete: 50 },
      },
      0
    );
    assert.strictEqual(returned.topic, 'DRAFT_READY');
    assert.strictEqual(returned.content.data.document.title, 'ERROR');
    assert.strictEqual(returned.content.data.document.documentType, 'OTHER');
    assert.deepStrictEqual(returned.content.data.document.sections, []);
    assert.strictEqual(returned.content.data.completionStatus.canValidate, false);
    assert.strictEqual(returned.content.data.delta, null);
  });

  it('iter 2+ with delta present — normal DRAFT_READY', function () {
    const delta = { revisedSections: [{ id: 'A1' }], newSections: [], removedSections: [] };
    const { returned } = runTransform(
      {
        summary: 'Revised sections',
        completionStatus: { canValidate: true, percentComplete: 80 },
        delta,
      },
      1
    );
    assert.strictEqual(returned.topic, 'DRAFT_READY');
    assert.strictEqual(returned.content.data.document, null);
    assert.deepStrictEqual(returned.content.data.delta, delta);
  });

  it('iter 2+ with delta missing — empty delta + warning', function () {
    const { returned, warnings } = runTransform(
      {
        summary: 'Nothing changed',
        completionStatus: { canValidate: true, percentComplete: 90 },
      },
      1
    );
    assert.strictEqual(returned.topic, 'DRAFT_READY');
    assert.strictEqual(returned.content.data.document, null);
    assert.deepStrictEqual(returned.content.data.delta, {
      revisedSections: [],
      newSections: [],
      removedSections: [],
    });
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('no delta'));
  });
});

describe('ERROR Document Recovery — Integration', function () {
  const { reconstructDocument } = require('../scripts/lib/doc-reconstruction');

  it('ERROR document passes through reconstructDocument without throwing', function () {
    const errorDoc = {
      document: { title: 'ERROR', documentType: 'OTHER', sections: [], perspectivesUsed: [] },
    };
    const result = reconstructDocument([errorDoc]);
    assert.strictEqual(result.title, 'ERROR');
    assert.strictEqual(result.documentType, 'OTHER');
    assert.deepStrictEqual(result.sections, []);
  });

  it('delta applied on top of ERROR document produces valid output', function () {
    const errorDoc = {
      document: { title: 'ERROR', documentType: 'OTHER', sections: [], perspectivesUsed: [] },
    };
    const delta = {
      delta: {
        revisedSections: [],
        newSections: [
          { id: 'A1', category: 'ACTION', heading: 'Step 1', depth: 2, content: 'Do thing' },
        ],
        removedSections: [],
      },
    };
    const result = reconstructDocument([errorDoc, delta]);
    assert.strictEqual(result.sections.length, 1);
    assert.strictEqual(result.sections[0].id, 'A1');
  });
});
