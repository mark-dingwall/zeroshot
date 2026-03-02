/**
 * Tests for docs-review-workflow boolean params, conditional validators,
 * analyst prompt rendering, and conductor boolean param computation.
 */

const assert = require('assert');
const path = require('path');
const TemplateResolver = require('../src/template-resolver');

describe('Review Workflow — Boolean Params & Conditional Validators', function () {
  let resolver;

  before(function () {
    const templatesDir = path.join(__dirname, '..', 'cluster-templates');
    resolver = new TemplateResolver(templatesDir);
  });

  // Base params shared by all docs-review-workflow resolutions
  function baseParams(overrides = {}) {
    return {
      tier: 'vector',
      analyst_level: 'level2',
      validator_level: 'level2',
      validator_count: 2,
      max_iterations: 4,
      max_tokens: 150000,
      artifact_scope: 'CHAIN',
      content_domain: 'GENERAL',
      has_test_content: false,
      is_chain: false,
      is_sensitive: false,
      ...overrides,
    };
  }

  function resolveWorkflow(overrides = {}) {
    return resolver.resolve('docs-review-workflow', baseParams(overrides));
  }

  function getValidatorIds(resolved) {
    return resolved.agents
      .filter((a) => a.role === 'validator')
      .map((a) => a.id)
      .sort();
  }

  // --- Validator activation matrix ---

  describe('Validator activation matrix', function () {
    it('trace tier — only evidence validator (no rigor, no augmentation)', function () {
      const resolved = resolveWorkflow({
        tier: 'trace',
        validator_count: 1,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence']);
    });

    it('trace tier + has_test_content — still only evidence (augmentation requires tier != trace)', function () {
      const resolved = resolveWorkflow({
        tier: 'trace',
        validator_count: 1,
        has_test_content: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence']);
    });

    it('trace tier + is_chain — still only evidence (augmentation requires tier != trace)', function () {
      const resolved = resolveWorkflow({
        tier: 'trace',
        validator_count: 1,
        is_chain: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence']);
    });

    it('vector tier — evidence + rigor (base validators)', function () {
      const resolved = resolveWorkflow({
        tier: 'vector',
        validator_count: 2,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence', 'validator-rigor']);
    });

    it('vector tier + is_chain — evidence + rigor + traceability', function () {
      const resolved = resolveWorkflow({
        tier: 'vector',
        validator_count: 2,
        is_chain: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, [
        'validator-evidence',
        'validator-rigor',
        'validator-traceability',
      ]);
    });

    it('vector tier + has_test_content — evidence + rigor + testability', function () {
      const resolved = resolveWorkflow({
        tier: 'vector',
        validator_count: 2,
        has_test_content: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, [
        'validator-evidence',
        'validator-rigor',
        'validator-testability',
      ]);
    });

    it('vector tier + both booleans — all four validators', function () {
      const resolved = resolveWorkflow({
        tier: 'vector',
        validator_count: 2,
        has_test_content: true,
        is_chain: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, [
        'validator-evidence',
        'validator-rigor',
        'validator-testability',
        'validator-traceability',
      ]);
    });

    it('axiom tier + both booleans — all four validators', function () {
      const resolved = resolveWorkflow({
        tier: 'axiom',
        analyst_level: 'level3',
        validator_count: 2,
        has_test_content: true,
        is_chain: true,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, [
        'validator-evidence',
        'validator-rigor',
        'validator-testability',
        'validator-traceability',
      ]);
    });

    it('axiom tier — evidence + rigor (no augmentation without booleans)', function () {
      const resolved = resolveWorkflow({
        tier: 'axiom',
        analyst_level: 'level3',
        validator_count: 2,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence', 'validator-rigor']);
    });
  });

  // --- Validator configuration ---

  describe('Validator configuration', function () {
    it('evidence validator has useDirectApi: false (CLI tools for fact-checking)', function () {
      const resolved = resolveWorkflow();
      const evidence = resolved.agents.find((a) => a.id === 'validator-evidence');
      assert.strictEqual(evidence.useDirectApi, false);
    });

    it('rigor validator has useDirectApi: true (context-only)', function () {
      const resolved = resolveWorkflow();
      const rigor = resolved.agents.find((a) => a.id === 'validator-rigor');
      assert.strictEqual(rigor.useDirectApi, true);
    });

    it('testability validator has useDirectApi: true (context-only)', function () {
      const resolved = resolveWorkflow({ has_test_content: true });
      const testability = resolved.agents.find((a) => a.id === 'validator-testability');
      assert.strictEqual(testability.useDirectApi, true);
    });

    it('traceability validator has useDirectApi: true (context-only)', function () {
      const resolved = resolveWorkflow({ is_chain: true });
      const traceability = resolved.agents.find((a) => a.id === 'validator-traceability');
      assert.strictEqual(traceability.useDirectApi, true);
    });

    it('all validators have role: validator', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      assert.strictEqual(validators.length, 4);
      for (const v of validators) {
        assert.strictEqual(v.role, 'validator');
      }
    });

    it('all validators trigger on IMPLEMENTATION_READY', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const trigger = v.triggers.find((t) => t.topic === 'IMPLEMENTATION_READY');
        assert.ok(trigger, `${v.id} should trigger on IMPLEMENTATION_READY`);
      }
    });

    it('all validators publish to VALIDATION_RESULT', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const script = v.hooks.onComplete.transform.script;
        assert.ok(
          script.includes("'VALIDATION_RESULT'"),
          `${v.id} transform should target VALIDATION_RESULT`
        );
        assert.strictEqual(v.hooks.onError.config.topic, 'VALIDATION_RESULT');
      }
    });

    it('all validators auto-reject on error', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const errorData = v.hooks.onError.config.content.data;
        assert.strictEqual(errorData.approved, false);
        assert.ok(errorData.validatorError);
      }
    });

    it('validators compute approved from findingReviews in transform hook', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const hook = v.hooks.onComplete;
        assert.ok(hook.transform, `${v.id} onComplete should use transform, not config`);
        assert.ok(!hook.config, `${v.id} onComplete should not have config`);
        assert.strictEqual(hook.transform.engine, 'javascript');
        const script = hook.transform.script;
        assert.ok(
          script.includes('findingReviews') && script.includes('approved'),
          `${v.id} transform should compute approved from findingReviews`
        );
        assert.ok(
          script.includes(
            "r.verdict === 'ACCEPT' || r.verdict === 'ACCEPT_WITH_NOTES' || r.verdict === 'DOWNGRADE'"
          ),
          `${v.id} transform should accept ACCEPT, ACCEPT_WITH_NOTES, and DOWNGRADE`
        );
      }
    });

    it('validator jsonSchema does not include approved field', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        assert.ok(
          !v.jsonSchema.properties.approved,
          `${v.id} schema should not have approved property`
        );
        assert.ok(
          !v.jsonSchema.required.includes('approved'),
          `${v.id} schema should not require approved`
        );
      }
    });

    it('all validators include STATE_SNAPSHOT at medium priority', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
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

    it('analyst does NOT include STATE_SNAPSHOT', function () {
      const resolved = resolveWorkflow();
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      const sources = analyst.contextStrategy.sources;
      const snapshot = sources.find((s) => s.topic === 'STATE_SNAPSHOT');
      assert.ok(!snapshot, 'analyst should not include STATE_SNAPSHOT source');
    });

    it('all validators include ACCEPT_WITH_NOTES and DOWNGRADE in verdict enum', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const verdictEnum = v.jsonSchema.properties.findingReviews.items.properties.verdict.enum;
        assert.ok(verdictEnum.includes('ACCEPT_WITH_NOTES'), `${v.id} missing ACCEPT_WITH_NOTES`);
        assert.ok(verdictEnum.includes('DOWNGRADE'), `${v.id} missing DOWNGRADE`);
      }
    });

    it('all validators have optional notes and suggestedSeverity fields', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const props = v.jsonSchema.properties.findingReviews.items.properties;
        assert.ok(props.notes, `${v.id} missing notes property`);
        assert.ok(props.suggestedSeverity, `${v.id} missing suggestedSeverity property`);
        const required = v.jsonSchema.properties.findingReviews.items.required;
        assert.ok(!required.includes('notes'), `${v.id} notes should not be required`);
        assert.ok(
          !required.includes('suggestedSeverity'),
          `${v.id} suggestedSeverity should not be required`
        );
      }
    });

    it('synthesizer finalReport includes validatorNotes and severityAdjustments', function () {
      const resolved = resolveWorkflow();
      const synth = resolved.agents.find((a) => a.id === 'synthesizer');
      const props = synth.jsonSchema.properties.finalReport.properties;
      assert.ok(props.validatorNotes, 'Should have validatorNotes');
      assert.strictEqual(props.validatorNotes.type, 'array');
      assert.ok(props.severityAdjustments, 'Should have severityAdjustments');
      assert.strictEqual(props.severityAdjustments.type, 'array');
    });
  });

  // --- Prompt rendering ---

  describe('Analyst prompt — boolean param rendering', function () {
    it('has_test_content=true renders MANDATORY Test Design Critic', function () {
      const resolved = resolveWorkflow({ has_test_content: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('MANDATORY — Test Design Critic'),
        'Should include MANDATORY Test Design Critic'
      );
      assert.ok(
        !analyst.prompt.initial.includes('Test Design Critic** (INACTIVE'),
        'Should NOT include INACTIVE Test Design Critic'
      );
    });

    it('has_test_content=false renders INACTIVE Test Design Critic', function () {
      const resolved = resolveWorkflow({ has_test_content: false });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('Test Design Critic** (INACTIVE'),
        'Should include INACTIVE Test Design Critic'
      );
      assert.ok(
        !analyst.prompt.initial.includes('MANDATORY — Test Design Critic'),
        'Should NOT include MANDATORY Test Design Critic'
      );
    });

    it('is_chain=true renders MANDATORY Chain Validator', function () {
      const resolved = resolveWorkflow({ is_chain: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('MANDATORY — Chain Validator'),
        'Should include MANDATORY Chain Validator'
      );
      assert.ok(
        !analyst.prompt.initial.includes('Chain Validator** (INACTIVE'),
        'Should NOT include INACTIVE Chain Validator'
      );
    });

    it('is_chain=false renders INACTIVE Chain Validator', function () {
      const resolved = resolveWorkflow({ is_chain: false });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('Chain Validator** (INACTIVE'),
        'Should include INACTIVE Chain Validator'
      );
      assert.ok(
        !analyst.prompt.initial.includes('MANDATORY — Chain Validator'),
        'Should NOT include MANDATORY Chain Validator'
      );
    });

    it('is_sensitive=true renders MANDATORY Security/Domain Specialist', function () {
      const resolved = resolveWorkflow({ is_sensitive: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('MANDATORY — Security/Domain Specialist'),
        'Should include MANDATORY Security/Domain Specialist'
      );
      assert.ok(
        !analyst.prompt.initial.includes('Security/Domain Specialist** (INACTIVE'),
        'Should NOT include INACTIVE Security/Domain Specialist'
      );
    });

    it('is_sensitive=false renders INACTIVE Security/Domain Specialist', function () {
      const resolved = resolveWorkflow({ is_sensitive: false });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('Security/Domain Specialist** (INACTIVE'),
        'Should include INACTIVE Security/Domain Specialist'
      );
      assert.ok(
        !analyst.prompt.initial.includes('MANDATORY — Security/Domain Specialist'),
        'Should NOT include MANDATORY Security/Domain Specialist'
      );
    });

    it('subsequent prompt includes boolean param context', function () {
      const resolved = resolveWorkflow({ has_test_content: true, is_chain: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.subsequent.includes('has_test_content: true'),
        'Subsequent prompt should include has_test_content'
      );
      assert.ok(
        analyst.prompt.subsequent.includes('is_chain: true'),
        'Subsequent prompt should include is_chain'
      );
    });

    it('trace tier renders correct spawning rules', function () {
      const resolved = resolveWorkflow({
        tier: 'trace',
        validator_count: 1,
        has_test_content: true,
      });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(analyst.prompt.initial.includes('TRACE tier'), 'Should render TRACE tier rules');
      assert.ok(
        analyst.prompt.initial.includes('MANDATORY perspectives from boolean params'),
        'TRACE tier rules should mention MANDATORY perspectives'
      );
    });
  });

  // --- Prompt orthogonality ---

  describe('Validator prompt orthogonality', function () {
    it('evidence prompt focuses on factual verification, not reasoning', function () {
      const resolved = resolveWorkflow();
      const evidence = resolved.agents.find((a) => a.id === 'validator-evidence');
      const prompt = evidence.prompt.system;
      assert.ok(prompt.includes('ARTIFACT FACT-CHECKER'), 'Should identify as fact-checker');
      assert.ok(prompt.includes('FACTUAL VERIFICATION ONLY'), 'Should focus on facts');
      assert.ok(
        prompt.includes("rigor validator's job"),
        'Should reference rigor for reasoning checks'
      );
    });

    it('rigor prompt focuses on reasoning, not factual claims', function () {
      const resolved = resolveWorkflow();
      const rigor = resolved.agents.find((a) => a.id === 'validator-rigor');
      const prompt = rigor.prompt.system;
      assert.ok(prompt.includes('REASONING QUALITY ONLY'), 'Should focus on reasoning');
      assert.ok(
        prompt.includes("evidence validator's job"),
        'Should reference evidence for fact-checking'
      );
      assert.ok(
        prompt.includes('Assume quoted text is accurate'),
        'Should not re-verify artifact claims'
      );
    });
  });

  // --- Subagent batching & terseness ---

  describe('Subagent batching and terseness', function () {
    it('axiom prompt uses batched spawning, not single-message', function () {
      const resolved = resolveWorkflow({
        tier: 'axiom',
        analyst_level: 'level3',
        validator_count: 2,
      });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('BATCHES of at most 4'),
        'Axiom initial prompt should include batching guidance'
      );
      assert.ok(
        !analyst.prompt.initial.includes('SINGLE message (up to 8'),
        'Axiom initial prompt should NOT include single-message spawning'
      );
      assert.ok(
        analyst.prompt.subsequent.includes('BATCHES of at most 4'),
        'Axiom subsequent prompt should include batching guidance'
      );
      assert.ok(
        !analyst.prompt.subsequent.includes('SINGLE message (parallel, up to 8'),
        'Axiom subsequent prompt should NOT include single-message spawning'
      );
    });

    it('subagent prompt template includes terseness guidance', function () {
      const resolved = resolveWorkflow();
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('high information density'),
        'Subagent template should include terseness guidance'
      );
    });
  });

  // --- Default params ---

  describe('Boolean param defaults', function () {
    it('has_test_content defaults to false', function () {
      const info = resolver.getTemplateInfo('docs-review-workflow');
      assert.strictEqual(info.params.has_test_content.default, false);
    });

    it('is_chain defaults to false', function () {
      const info = resolver.getTemplateInfo('docs-review-workflow');
      assert.strictEqual(info.params.is_chain.default, false);
    });

    it('is_sensitive defaults to false', function () {
      const info = resolver.getTemplateInfo('docs-review-workflow');
      assert.strictEqual(info.params.is_sensitive.default, false);
    });
  });
});

describe('Review Conductor — Boolean Param Computation', function () {
  // Extract and test the boolean param computation logic from conductor transform scripts
  // This mirrors the logic in review-conductor.json junior/senior transform scripts

  function computeBooleanParams(artifactTypes, artifactScope, contentDomain) {
    return {
      has_test_content:
        artifactTypes.includes('test_suite') || artifactTypes.includes('acceptance_criteria'),
      is_sensitive: contentDomain === 'SENSITIVE',
      is_chain: artifactScope === 'CHAIN',
    };
  }

  it('single requirements doc → all false', function () {
    const result = computeBooleanParams(['requirements'], 'SINGLE', 'GENERAL');
    assert.deepStrictEqual(result, {
      has_test_content: false,
      is_sensitive: false,
      is_chain: false,
    });
  });

  it('requirements + AC → has_test_content + is_chain', function () {
    const result = computeBooleanParams(
      ['requirements', 'acceptance_criteria'],
      'CHAIN',
      'GENERAL'
    );
    assert.deepStrictEqual(result, {
      has_test_content: true,
      is_sensitive: false,
      is_chain: true,
    });
  });

  it('test_suite alone → has_test_content (not is_chain for single type)', function () {
    const result = computeBooleanParams(['test_suite'], 'SINGLE', 'GENERAL');
    assert.deepStrictEqual(result, {
      has_test_content: true,
      is_sensitive: false,
      is_chain: false,
    });
  });

  it('is_chain strict: 2+ artifact types without CHAIN scope remains false', function () {
    const result = computeBooleanParams(
      ['requirements', 'implementation_plan'],
      'SINGLE',
      'GENERAL'
    );
    assert.deepStrictEqual(result, {
      has_test_content: false,
      is_sensitive: false,
      is_chain: false, // Only CHAIN scope triggers is_chain
    });
  });

  it('SENSITIVE domain → is_sensitive', function () {
    const result = computeBooleanParams(['requirements'], 'SINGLE', 'SENSITIVE');
    assert.deepStrictEqual(result, {
      has_test_content: false,
      is_sensitive: true,
      is_chain: false,
    });
  });

  it('full chain + sensitive → all true', function () {
    const result = computeBooleanParams(
      ['requirements', 'acceptance_criteria', 'test_suite'],
      'CHAIN',
      'SENSITIVE'
    );
    assert.deepStrictEqual(result, {
      has_test_content: true,
      is_sensitive: true,
      is_chain: true,
    });
  });

  it('architecture_doc alone → all false', function () {
    const result = computeBooleanParams(['architecture_doc'], 'SINGLE', 'GENERAL');
    assert.deepStrictEqual(result, {
      has_test_content: false,
      is_sensitive: false,
      is_chain: false,
    });
  });
});

describe('Direct-Routed Configs — Boolean Param Defaults', function () {
  // Verify the hardcoded boolean params in docs-review-trace/vector/axiom transform scripts
  // by checking the JS strings in the JSON files

  const fs = require('fs');
  const templatesDir = path.join(__dirname, '..', 'cluster-templates');

  function readTransformScript(configFile) {
    const config = JSON.parse(fs.readFileSync(path.join(templatesDir, configFile), 'utf8'));
    return config.agents[0].hooks.onComplete.transform.script;
  }

  it('docs-review-trace sets all boolean params to false', function () {
    const script = readTransformScript('docs-review-trace.json');
    assert.ok(script.includes('has_test_content: false'), 'has_test_content should be false');
    assert.ok(script.includes('is_chain: false'), 'is_chain should be false');
    assert.ok(script.includes('is_sensitive: false'), 'is_sensitive should be false');
  });

  it('docs-review-vector sets is_chain: true, others false', function () {
    const script = readTransformScript('docs-review-vector.json');
    assert.ok(script.includes('has_test_content: false'), 'has_test_content should be false');
    assert.ok(script.includes('is_chain: true'), 'is_chain should be true');
    assert.ok(script.includes('is_sensitive: false'), 'is_sensitive should be false');
  });

  it('docs-review-axiom sets is_chain + is_sensitive: true', function () {
    const script = readTransformScript('docs-review-axiom.json');
    assert.ok(script.includes('has_test_content: false'), 'has_test_content should be false');
    assert.ok(script.includes('is_chain: true'), 'is_chain should be true');
    assert.ok(script.includes('is_sensitive: true'), 'is_sensitive should be true');
  });
});
