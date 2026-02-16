/**
 * Tests for code-review-workflow boolean params, conditional validators,
 * analyst prompt rendering, conductor routing, and direct-routed configs.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const TemplateResolver = require('../src/template-resolver');

describe('Code Review Workflow — Validators & Boolean Params', function () {
  let resolver;

  before(function () {
    const templatesDir = path.join(__dirname, '..', 'cluster-templates');
    resolver = new TemplateResolver(templatesDir);
  });

  function baseParams(overrides = {}) {
    return {
      tier: 'book',
      analyst_level: 'level2',
      validator_level: 'level2',
      validator_count: 2,
      max_iterations: 4,
      max_tokens: 150000,
      change_scope: 'MODULE',
      risk_domain: 'GENERAL',
      has_security_surface: false,
      has_test_changes: false,
      has_api_changes: false,
      ...overrides,
    };
  }

  function resolveWorkflow(overrides = {}) {
    return resolver.resolve('code-review-workflow', baseParams(overrides));
  }

  function getValidatorIds(resolved) {
    return resolved.agents
      .filter((a) => a.role === 'validator')
      .map((a) => a.id)
      .sort();
  }

  // --- Validator activation matrix ---

  describe('Validator activation matrix', function () {
    it('bell tier — only evidence validator (validator_count=1 excludes rigor)', function () {
      const resolved = resolveWorkflow({
        tier: 'bell',
        validator_count: 1,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence']);
    });

    it('book tier — evidence + rigor (validator_count=2)', function () {
      const resolved = resolveWorkflow({
        tier: 'book',
        validator_count: 2,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence', 'validator-rigor']);
    });

    it('candle tier — evidence + rigor (validator_count=2)', function () {
      const resolved = resolveWorkflow({
        tier: 'candle',
        analyst_level: 'level3',
        validator_count: 2,
      });
      const validators = getValidatorIds(resolved);
      assert.deepStrictEqual(validators, ['validator-evidence', 'validator-rigor']);
    });

    it('no conditional validators regardless of boolean params', function () {
      const resolved = resolveWorkflow({
        tier: 'book',
        validator_count: 2,
        has_security_surface: true,
        has_test_changes: true,
        has_api_changes: true,
      });
      const validators = getValidatorIds(resolved);
      // Code review workflow has no conditional validators (unlike review-workflow)
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

    it('all validators have role: validator', function () {
      const resolved = resolveWorkflow();
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      assert.strictEqual(validators.length, 2);
      for (const v of validators) {
        assert.strictEqual(v.role, 'validator');
      }
    });

    it('all validators trigger on IMPLEMENTATION_READY', function () {
      const resolved = resolveWorkflow();
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const trigger = v.triggers.find((t) => t.topic === 'IMPLEMENTATION_READY');
        assert.ok(trigger, `${v.id} should trigger on IMPLEMENTATION_READY`);
      }
    });

    it('all validators publish to VALIDATION_RESULT via transform', function () {
      const resolved = resolveWorkflow();
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
      const resolved = resolveWorkflow();
      const validators = resolved.agents.filter((a) => a.role === 'validator');
      for (const v of validators) {
        const errorData = v.hooks.onError.config.content.data;
        assert.strictEqual(errorData.approved, false);
        assert.ok(errorData.validatorError);
      }
    });

    it('validators compute approved from findingReviews in transform hook', function () {
      const resolved = resolveWorkflow();
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
          script.includes(".every(r => r.verdict === 'ACCEPT')"),
          `${v.id} transform should check all verdicts are ACCEPT`
        );
      }
    });

    it('validator jsonSchema does not include approved field', function () {
      const resolved = resolveWorkflow();
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
  });

  // --- Analyst prompt rendering ---

  describe('Analyst prompt — boolean param rendering', function () {
    it('has_security_surface=true renders MANDATORY Security Reviewer', function () {
      const resolved = resolveWorkflow({ has_security_surface: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('MANDATORY — Security Reviewer'),
        'Should include MANDATORY Security Reviewer'
      );
      assert.ok(
        !analyst.prompt.initial.includes('Security Reviewer** (INACTIVE'),
        'Should NOT include INACTIVE Security Reviewer'
      );
    });

    it('has_security_surface=false renders INACTIVE Security Reviewer', function () {
      const resolved = resolveWorkflow({ has_security_surface: false });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('Security Reviewer** (INACTIVE'),
        'Should include INACTIVE Security Reviewer'
      );
      assert.ok(
        !analyst.prompt.initial.includes('MANDATORY — Security Reviewer'),
        'Should NOT include MANDATORY Security Reviewer'
      );
    });

    it('has_test_changes=true renders MANDATORY Test Coverage Analyst', function () {
      const resolved = resolveWorkflow({ has_test_changes: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('MANDATORY — Test Coverage Analyst'),
        'Should include MANDATORY Test Coverage Analyst'
      );
      assert.ok(
        !analyst.prompt.initial.includes('Test Coverage Analyst** (INACTIVE'),
        'Should NOT include INACTIVE Test Coverage Analyst'
      );
    });

    it('has_test_changes=false renders INACTIVE Test Coverage Analyst', function () {
      const resolved = resolveWorkflow({ has_test_changes: false });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('Test Coverage Analyst** (INACTIVE'),
        'Should include INACTIVE Test Coverage Analyst'
      );
      assert.ok(
        !analyst.prompt.initial.includes('MANDATORY — Test Coverage Analyst'),
        'Should NOT include MANDATORY Test Coverage Analyst'
      );
    });

    it('has_api_changes=true renders MANDATORY API/Interface Reviewer', function () {
      const resolved = resolveWorkflow({ has_api_changes: true });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('MANDATORY — API/Interface Reviewer'),
        'Should include MANDATORY API/Interface Reviewer'
      );
      assert.ok(
        !analyst.prompt.initial.includes('API/Interface Reviewer** (INACTIVE'),
        'Should NOT include INACTIVE API/Interface Reviewer'
      );
    });

    it('has_api_changes=false renders INACTIVE API/Interface Reviewer', function () {
      const resolved = resolveWorkflow({ has_api_changes: false });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.initial.includes('API/Interface Reviewer** (INACTIVE'),
        'Should include INACTIVE API/Interface Reviewer'
      );
      assert.ok(
        !analyst.prompt.initial.includes('MANDATORY — API/Interface Reviewer'),
        'Should NOT include MANDATORY API/Interface Reviewer'
      );
    });

    it('subsequent prompt includes boolean param context', function () {
      const resolved = resolveWorkflow({
        has_security_surface: true,
        has_test_changes: true,
        has_api_changes: true,
      });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        analyst.prompt.subsequent.includes('has_security_surface: true'),
        'Subsequent prompt should include has_security_surface'
      );
      assert.ok(
        analyst.prompt.subsequent.includes('has_test_changes: true'),
        'Subsequent prompt should include has_test_changes'
      );
      assert.ok(
        analyst.prompt.subsequent.includes('has_api_changes: true'),
        'Subsequent prompt should include has_api_changes'
      );
    });

    it('bell tier renders correct spawning rules', function () {
      const resolved = resolveWorkflow({
        tier: 'bell',
        validator_count: 1,
      });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(analyst.prompt.initial.includes('BELL tier'), 'Should render BELL tier rules');
    });

    it('book tier renders correct spawning rules', function () {
      const resolved = resolveWorkflow({
        tier: 'book',
        validator_count: 2,
      });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(analyst.prompt.initial.includes('BOOK tier'), 'Should render BOOK tier rules');
    });

    it('candle tier renders correct spawning rules', function () {
      const resolved = resolveWorkflow({
        tier: 'candle',
        analyst_level: 'level3',
        validator_count: 2,
      });
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(analyst.prompt.initial.includes('CANDLE tier'), 'Should render CANDLE tier rules');
    });
  });

  // --- Finding categories ---

  describe('Finding categories', function () {
    it('uses code-review-specific categories, not review-workflow categories', function () {
      const resolved = resolveWorkflow();
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      const categoryEnum =
        analyst.jsonSchema.properties.report.properties.findings.items.properties.category.enum;

      // Code review categories
      assert.ok(categoryEnum.includes('BUG'), 'Should include BUG');
      assert.ok(categoryEnum.includes('RACE_CONDITION'), 'Should include RACE_CONDITION');
      assert.ok(categoryEnum.includes('ERROR_HANDLING'), 'Should include ERROR_HANDLING');
      assert.ok(categoryEnum.includes('PERFORMANCE'), 'Should include PERFORMANCE');
      assert.ok(categoryEnum.includes('BREAKING_CHANGE'), 'Should include BREAKING_CHANGE');
      assert.ok(categoryEnum.includes('DEAD_CODE'), 'Should include DEAD_CODE');
      assert.ok(categoryEnum.includes('MISSING_TEST'), 'Should include MISSING_TEST');
      assert.ok(categoryEnum.includes('STYLE'), 'Should include STYLE');

      // Should NOT include review-workflow categories
      assert.ok(!categoryEnum.includes('AMBIGUITY'), 'Should NOT include AMBIGUITY');
      assert.ok(!categoryEnum.includes('CONTRADICTION'), 'Should NOT include CONTRADICTION');
      assert.ok(!categoryEnum.includes('LOGIC_FLAW'), 'Should NOT include LOGIC_FLAW');
      assert.ok(!categoryEnum.includes('UNTESTABLE'), 'Should NOT include UNTESTABLE');
      assert.ok(!categoryEnum.includes('GAP'), 'Should NOT include GAP');
      assert.ok(!categoryEnum.includes('FALSE_COVERAGE'), 'Should NOT include FALSE_COVERAGE');
    });

    it('does not include traceabilityMatrix in schema', function () {
      const resolved = resolveWorkflow();
      const analyst = resolved.agents.find((a) => a.id === 'analyst');
      assert.ok(
        !analyst.jsonSchema.properties.report.properties.traceabilityMatrix,
        'Should NOT include traceabilityMatrix in code review schema'
      );
    });
  });

  // --- Default params ---

  describe('Boolean param defaults', function () {
    it('has_security_surface defaults to false', function () {
      const info = resolver.getTemplateInfo('code-review-workflow');
      assert.strictEqual(info.params.has_security_surface.default, false);
    });

    it('has_test_changes defaults to false', function () {
      const info = resolver.getTemplateInfo('code-review-workflow');
      assert.strictEqual(info.params.has_test_changes.default, false);
    });

    it('has_api_changes defaults to false', function () {
      const info = resolver.getTemplateInfo('code-review-workflow');
      assert.strictEqual(info.params.has_api_changes.default, false);
    });
  });

  // --- Completion detector ---

  describe('Completion detector', function () {
    it('uses REPORT_TITLE env var for Code Review Report title', function () {
      const resolved = resolveWorkflow();
      const detector = resolved.agents.find((a) => a.id === 'completion-detector');
      const command = detector.triggers[0].config.command;
      assert.ok(
        command.includes("REPORT_TITLE='# Code Review Report'"),
        'Should set REPORT_TITLE to Code Review Report'
      );
    });
  });
});

describe('Code Review Conductor — Boolean Param & Routing', function () {
  // Test the routing logic from conductor transform scripts

  function computeRouting(changeScope, riskDomain) {
    if (changeScope === 'CROSS_CUTTING') return 'candle';
    if (changeScope === 'MODULE' && riskDomain === 'SENSITIVE') return 'candle';
    if (changeScope === 'MODULE' || riskDomain === 'SENSITIVE') return 'book';
    return 'bell';
  }

  it('PATCH + GENERAL → bell', function () {
    assert.strictEqual(computeRouting('PATCH', 'GENERAL'), 'bell');
  });

  it('PATCH + SENSITIVE → book', function () {
    assert.strictEqual(computeRouting('PATCH', 'SENSITIVE'), 'book');
  });

  it('MODULE + GENERAL → book', function () {
    assert.strictEqual(computeRouting('MODULE', 'GENERAL'), 'book');
  });

  it('MODULE + SENSITIVE → candle', function () {
    assert.strictEqual(computeRouting('MODULE', 'SENSITIVE'), 'candle');
  });

  it('CROSS_CUTTING + GENERAL → candle', function () {
    assert.strictEqual(computeRouting('CROSS_CUTTING', 'GENERAL'), 'candle');
  });

  it('CROSS_CUTTING + SENSITIVE → candle', function () {
    assert.strictEqual(computeRouting('CROSS_CUTTING', 'SENSITIVE'), 'candle');
  });
});

describe('Direct-Routed Code Review Configs — Params', function () {
  const templatesDir = path.join(__dirname, '..', 'cluster-templates');

  function readTransformScript(configFile) {
    const config = JSON.parse(fs.readFileSync(path.join(templatesDir, configFile), 'utf8'));
    return config.agents[0].hooks.onComplete.transform.script;
  }

  it('code-review-bell sets all boolean params to false', function () {
    const script = readTransformScript('code-review-bell.json');
    assert.ok(
      script.includes('has_security_surface: false'),
      'has_security_surface should be false'
    );
    assert.ok(script.includes('has_test_changes: false'), 'has_test_changes should be false');
    assert.ok(script.includes('has_api_changes: false'), 'has_api_changes should be false');
  });

  it('code-review-bell routes to code-review-workflow base', function () {
    const script = readTransformScript('code-review-bell.json');
    assert.ok(
      script.includes("base: 'code-review-workflow'"),
      'Should use code-review-workflow base'
    );
  });

  it('code-review-bell has correct tier params', function () {
    const script = readTransformScript('code-review-bell.json');
    assert.ok(script.includes("tier: 'bell'"), 'tier should be bell');
    assert.ok(script.includes('validator_count: 1'), 'validator_count should be 1');
    assert.ok(script.includes('max_iterations: 3'), 'max_iterations should be 3');
    assert.ok(script.includes('max_tokens: 100000'), 'max_tokens should be 100000');
  });

  it('code-review-book sets all boolean params to false', function () {
    const script = readTransformScript('code-review-book.json');
    assert.ok(
      script.includes('has_security_surface: false'),
      'has_security_surface should be false'
    );
    assert.ok(script.includes('has_test_changes: false'), 'has_test_changes should be false');
    assert.ok(script.includes('has_api_changes: false'), 'has_api_changes should be false');
  });

  it('code-review-book has correct tier params', function () {
    const script = readTransformScript('code-review-book.json');
    assert.ok(script.includes("tier: 'book'"), 'tier should be book');
    assert.ok(script.includes('validator_count: 2'), 'validator_count should be 2');
    assert.ok(script.includes('max_iterations: 4'), 'max_iterations should be 4');
    assert.ok(script.includes('max_tokens: 150000'), 'max_tokens should be 150000');
  });

  it('code-review-candle sets all boolean params to false', function () {
    const script = readTransformScript('code-review-candle.json');
    assert.ok(
      script.includes('has_security_surface: false'),
      'has_security_surface should be false'
    );
    assert.ok(script.includes('has_test_changes: false'), 'has_test_changes should be false');
    assert.ok(script.includes('has_api_changes: false'), 'has_api_changes should be false');
  });

  it('code-review-candle has correct tier params', function () {
    const script = readTransformScript('code-review-candle.json');
    assert.ok(script.includes("tier: 'candle'"), 'tier should be candle');
    assert.ok(script.includes('validator_count: 2'), 'validator_count should be 2');
    assert.ok(script.includes('max_iterations: 5'), 'max_iterations should be 5');
    assert.ok(script.includes('max_tokens: 150000'), 'max_tokens should be 150000');
    assert.ok(script.includes("analyst_level: 'level3'"), 'analyst_level should be level3');
  });

  it('all direct configs use [CODE-REVIEW:TIER] transform text', function () {
    for (const [file, tier] of [
      ['code-review-bell.json', 'BELL'],
      ['code-review-book.json', 'BOOK'],
      ['code-review-candle.json', 'CANDLE'],
    ]) {
      const script = readTransformScript(file);
      assert.ok(
        script.includes(`[CODE-REVIEW:${tier}]`),
        `${file} should include [CODE-REVIEW:${tier}] in transform text`
      );
    }
  });
});
