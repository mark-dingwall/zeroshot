/**
 * Tests for lib/quality-detection.js — ecosystem detection and quality config management.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sinon = require('sinon');
const {
  detectQualityCommand,
  sanitizeLLMResponse,
  buildProjectContext,
  buildCLIArgs,
  SOURCE_HEURISTIC,
  SOURCE_HEURISTIC_FAILED,
  SOURCE_LLM_FAILED,
} = require('../lib/quality-detection');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qd-test-'));
}

function writeFile(dir, name, content = '') {
  const filePath = path.join(dir, name);
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
}

describe('detectQualityCommand', function () {
  let tmpDir;

  beforeEach(function () {
    tmpDir = makeTmpDir();
  });

  afterEach(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null for empty directory', function () {
    const result = detectQualityCommand(tmpDir);
    assert.strictEqual(result.command, null);
    assert.deepStrictEqual(result.ecosystems, []);
  });

  // ─── Node.js ──────────────────────────────────────────────────────

  it('should detect Node with npm scripts', function () {
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { lint: 'eslint .', test: 'mocha' },
      })
    );
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('npm run lint'));
    assert.ok(result.command.includes('npm test'));
    assert.ok(result.ecosystems.includes('node'));
  });

  it('should detect Node with bun lockfile', function () {
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'bun test' },
      })
    );
    writeFile(tmpDir, 'bun.lockb');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('bun test'));
  });

  it('should detect Node with pnpm lockfile', function () {
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'vitest' },
      })
    );
    writeFile(tmpDir, 'pnpm-lock.yaml');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('pnpm test'));
  });

  it('should detect Node with yarn lockfile', function () {
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'jest' },
      })
    );
    writeFile(tmpDir, 'yarn.lock');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('yarn test'));
  });

  it('should detect Node with config files when no scripts', function () {
    writeFile(tmpDir, 'package.json', JSON.stringify({ name: 'myapp', version: '1.0.0' }));
    writeFile(tmpDir, 'tsconfig.json', '{}');
    writeFile(tmpDir, 'vitest.config.ts', '');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('npx tsc --noEmit'));
    assert.ok(result.command.includes('npx vitest run'));
  });

  it('should detect Node build script', function () {
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { build: 'tsc' },
      })
    );
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('npm run build'));
  });

  it('should detect Node check script', function () {
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { check: 'svelte-check' },
      })
    );
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('npm run check'));
  });

  // ─── Deno ─────────────────────────────────────────────────────────

  it('should detect Deno project', function () {
    writeFile(tmpDir, 'deno.json', '{}');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('deno lint'));
    assert.ok(result.command.includes('deno test'));
    assert.ok(result.ecosystems.includes('deno'));
  });

  // ─── Python ───────────────────────────────────────────────────────

  it('should detect Python with pytest', function () {
    writeFile(tmpDir, 'requirements.txt', 'flask\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('python -m pytest'));
    assert.ok(result.ecosystems.includes('python'));
  });

  it('should detect Python with ruff', function () {
    writeFile(tmpDir, 'pyproject.toml', '[tool.ruff]\nline-length = 88\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('ruff check .'));
    assert.ok(result.command.includes('python -m pytest'));
  });

  it('should detect Python with mypy', function () {
    writeFile(tmpDir, 'pyproject.toml', '[tool.mypy]\nstrict = true\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('mypy .'));
  });

  it('should detect Django project', function () {
    writeFile(tmpDir, 'requirements.txt', 'django\n');
    writeFile(tmpDir, 'manage.py', '');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('python manage.py check'));
    assert.ok(result.command.includes('python manage.py test'));
  });

  // ─── Rust ─────────────────────────────────────────────────────────

  it('should detect Rust project', function () {
    writeFile(tmpDir, 'Cargo.toml', '[package]\nname = "test"\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('cargo clippy -- -D warnings'));
    assert.ok(result.command.includes('cargo test'));
    assert.ok(result.ecosystems.includes('rust'));
  });

  // ─── Go ───────────────────────────────────────────────────────────

  it('should detect Go project', function () {
    writeFile(tmpDir, 'go.mod', 'module example.com/test\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('go vet ./...'));
    assert.ok(result.command.includes('go test ./...'));
    assert.ok(result.ecosystems.includes('go'));
  });

  // ─── Java ─────────────────────────────────────────────────────────

  it('should detect Maven project', function () {
    writeFile(tmpDir, 'pom.xml', '<project></project>');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('mvn test'));
    assert.ok(result.ecosystems.includes('java'));
  });

  it('should detect Maven wrapper', function () {
    writeFile(tmpDir, 'pom.xml', '<project></project>');
    writeFile(tmpDir, 'mvnw', '');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('./mvnw test'));
  });

  it('should detect Gradle project', function () {
    writeFile(tmpDir, 'build.gradle', 'apply plugin: "java"');
    writeFile(tmpDir, 'gradlew', '');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('./gradlew test'));
  });

  // ─── Ruby ─────────────────────────────────────────────────────────

  it('should detect Ruby with RSpec', function () {
    writeFile(tmpDir, 'Gemfile', "gem 'rspec'\n");
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('bundle exec rspec'));
    assert.ok(result.ecosystems.includes('ruby'));
  });

  it('should detect Rails project', function () {
    writeFile(tmpDir, 'Gemfile', "gem 'rails'\n");
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('bin/rails test'));
  });

  // ─── PHP ──────────────────────────────────────────────────────────

  it('should detect PHP Laravel project', function () {
    writeFile(
      tmpDir,
      'composer.json',
      JSON.stringify({
        require: { 'laravel/framework': '^10.0' },
      })
    );
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('php artisan test'));
    assert.ok(result.ecosystems.includes('php'));
  });

  // ─── C#/.NET ──────────────────────────────────────────────────────

  it('should detect .NET project', function () {
    writeFile(tmpDir, 'MyApp.sln', '');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('dotnet build'));
    assert.ok(result.command.includes('dotnet test'));
    assert.ok(result.ecosystems.includes('dotnet'));
  });

  // ─── Swift ────────────────────────────────────────────────────────

  it('should detect Swift project', function () {
    writeFile(tmpDir, 'Package.swift', '');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('swift build'));
    assert.ok(result.command.includes('swift test'));
    assert.ok(result.ecosystems.includes('swift'));
  });

  // ─── Dart ─────────────────────────────────────────────────────────

  it('should detect Dart project', function () {
    writeFile(tmpDir, 'pubspec.yaml', 'name: test\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('dart analyze'));
    assert.ok(result.command.includes('dart test'));
    assert.ok(result.ecosystems.includes('dart'));
  });

  // ─── Scala ────────────────────────────────────────────────────────

  it('should detect Scala sbt project', function () {
    writeFile(tmpDir, 'build.sbt', 'name := "test"');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('sbt compile'));
    assert.ok(result.command.includes('sbt test'));
    assert.ok(result.ecosystems.includes('scala'));
  });

  // ─── C/C++ ────────────────────────────────────────────────────────

  it('should detect CMake project', function () {
    writeFile(tmpDir, 'CMakeLists.txt', 'cmake_minimum_required(VERSION 3.10)');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('cmake'));
    assert.ok(result.ecosystems.includes('cpp'));
  });

  it('should detect Makefile with test target', function () {
    writeFile(tmpDir, 'Makefile', 'test:\n\t./run_tests\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('make test'));
  });

  it('should detect Makefile with lint and check targets', function () {
    writeFile(tmpDir, 'Makefile', 'lint:\n\tflake8\ncheck:\n\tpytest\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('make lint'));
    assert.ok(result.command.includes('make check'));
  });

  // ─── Multi-ecosystem ─────────────────────────────────────────────

  it('should detect multi-ecosystem project (PHP + Node)', function () {
    writeFile(
      tmpDir,
      'composer.json',
      JSON.stringify({
        require: { 'laravel/framework': '^10.0' },
      })
    );
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { build: 'vite build' },
      })
    );
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.ecosystems.includes('php'));
    assert.ok(result.ecosystems.includes('node'));
    assert.ok(result.command.includes('php artisan test'));
    assert.ok(result.command.includes('npm run build'));
  });

  it('should detect multi-ecosystem project (Go + Node)', function () {
    writeFile(tmpDir, 'go.mod', 'module example.com/test\n');
    writeFile(
      tmpDir,
      'package.json',
      JSON.stringify({
        scripts: { lint: 'eslint .' },
      })
    );
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.ecosystems.includes('go'));
    assert.ok(result.ecosystems.includes('node'));
  });

  // ─── R ────────────────────────────────────────────────────────────

  it('should detect R project', function () {
    writeFile(tmpDir, 'DESCRIPTION', 'Package: test\n');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('R CMD check .'));
    assert.ok(result.ecosystems.includes('r'));
  });

  // ─── Lua ──────────────────────────────────────────────────────────

  it('should detect Lua project', function () {
    writeFile(tmpDir, 'mylib-1.0-1.rockspec', '');
    const result = detectQualityCommand(tmpDir);
    assert.ok(result.command.includes('luacheck .'));
    assert.ok(result.ecosystems.includes('lua'));
  });
});

describe('ensureQualityConfig', function () {
  let tmpDir;
  let projectsDir;
  let originalEnv;
  let commandExistsStub;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    projectsDir = path.join(tmpDir, 'zs-projects');
    originalEnv = process.env.ZEROSHOT_PROJECTS_DIR;
    process.env.ZEROSHOT_PROJECTS_DIR = projectsDir;
    // Clear require caches so modules pick up new env
    delete require.cache[require.resolve('../lib/project-config')];
    delete require.cache[require.resolve('../lib/quality-detection')];
    // Stub out LLM detection — these tests exercise heuristic logic only
    const providerDetection = require('../lib/provider-detection');
    commandExistsStub = sinon.stub(providerDetection, 'commandExists').returns(false);
  });

  afterEach(function () {
    if (commandExistsStub) {
      commandExistsStub.restore();
      commandExistsStub = null;
    }
    if (originalEnv === undefined) {
      delete process.env.ZEROSHOT_PROJECTS_DIR;
    } else {
      process.env.ZEROSHOT_PROJECTS_DIR = originalEnv;
    }
    delete require.cache[require.resolve('../lib/project-config')];
    delete require.cache[require.resolve('../lib/quality-detection')];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function getQualityDetection() {
    return require('../lib/quality-detection');
  }

  function getProjectConfig() {
    return require('../lib/project-config');
  }

  it('should create project config for detected ecosystem', function () {
    const projectDir = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectDir, { recursive: true });
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'mocha' },
      })
    );

    const result = getQualityDetection().ensureQualityConfig(projectDir);

    assert.strictEqual(result.created, true);
    assert.ok(result.command.includes('npm test'));

    // Verify stored in project config
    const config = getProjectConfig().loadProjectConfig(projectDir);
    assert.strictEqual(config.qualityCommand, result.command);
    assert.strictEqual(config.source, SOURCE_HEURISTIC);
    assert.ok(config.ecosystems.includes('node'));
  });

  it('should skip when .zeroshot-quality exists (manual override)', function () {
    const projectDir = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectDir, { recursive: true });
    writeFile(projectDir, '.zeroshot-quality', 'custom command');
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'jest', lint: 'eslint .' },
      })
    );

    const result = getQualityDetection().ensureQualityConfig(projectDir);

    assert.strictEqual(result.created, false);

    // No project config should be written
    assert.strictEqual(getProjectConfig().loadProjectConfig(projectDir), null);
  });

  it('should skip when config already exists with valid source', function () {
    const projectDir = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectDir, { recursive: true });
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'mocha' },
      })
    );

    // Pre-create project config
    getProjectConfig().saveProjectConfig(projectDir, {
      qualityCommand: 'npm test',
      source: SOURCE_HEURISTIC,
      ecosystems: ['node'],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = getQualityDetection().ensureQualityConfig(projectDir);

    assert.strictEqual(result.created, false);
  });

  it('should return created=false when no ecosystem detected', function () {
    const projectDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(projectDir, { recursive: true });

    const result = getQualityDetection().ensureQualityConfig(projectDir);

    assert.strictEqual(result.created, false);
    assert.strictEqual(result.command, null);

    // Should record heuristic-failed
    const config = getProjectConfig().loadProjectConfig(projectDir);
    assert.strictEqual(config.source, SOURCE_HEURISTIC_FAILED);
  });

  it('should re-detect when source is heuristic-failed', function () {
    const projectDir = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectDir, { recursive: true });

    // Pre-create heuristic-failed config, then add ecosystem files
    getProjectConfig().saveProjectConfig(projectDir, {
      qualityCommand: null,
      source: SOURCE_HEURISTIC_FAILED,
      ecosystems: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // Now add project files so heuristic succeeds on retry
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'jest' },
      })
    );

    const result = getQualityDetection().ensureQualityConfig(projectDir);

    // LLM detection will fail (no CLI available in test), but heuristic retry should succeed
    assert.strictEqual(result.created, true);
    assert.ok(result.command.includes('npm test'));

    const config = getProjectConfig().loadProjectConfig(projectDir);
    assert.strictEqual(config.source, SOURCE_HEURISTIC);
  });

  it('should re-detect when source is llm-failed', function () {
    const projectDir = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectDir, { recursive: true });

    // Pre-create llm-failed config, then add ecosystem files
    getProjectConfig().saveProjectConfig(projectDir, {
      qualityCommand: null,
      source: SOURCE_LLM_FAILED,
      ecosystems: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // Now add project files so heuristic succeeds on retry
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'jest' },
      })
    );

    const result = getQualityDetection().ensureQualityConfig(projectDir);

    // LLM detection will fail (no CLI available in test), but heuristic retry should succeed
    assert.strictEqual(result.created, true);
    assert.ok(result.command.includes('npm test'));

    const config = getProjectConfig().loadProjectConfig(projectDir);
    assert.strictEqual(config.source, SOURCE_HEURISTIC);
  });

  it('should retroactively sanitize backtick-wrapped LLM command', function () {
    const projectDir = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectDir, { recursive: true });

    // Pre-create LLM config with backtick-wrapped command (pre-fix poisoned data)
    getProjectConfig().saveProjectConfig(projectDir, {
      qualityCommand: '`npm run lint && npm test`',
      source: 'llm',
      ecosystems: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = getQualityDetection().ensureQualityConfig(projectDir);

    // Should return early (not re-detect) but sanitize the stored command
    assert.strictEqual(result.created, false);

    const config = getProjectConfig().loadProjectConfig(projectDir);
    assert.strictEqual(config.qualityCommand, 'npm run lint && npm test');
    assert.strictEqual(config.source, 'llm');
  });

  it('should not write to project directory (no .zeroshot-quality, no .gitignore changes)', function () {
    const projectDir = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectDir, { recursive: true });
    writeFile(projectDir, '.gitignore', 'node_modules/\n');
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'mocha' },
      })
    );

    getQualityDetection().ensureQualityConfig(projectDir);

    // No .zeroshot-quality created in project
    assert.ok(!fs.existsSync(path.join(projectDir, '.zeroshot-quality')));

    // .gitignore not modified
    const gitignore = fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf-8');
    assert.strictEqual(gitignore, 'node_modules/\n');
  });
});

describe('sanitizeLLMResponse', function () {
  it('should strip markdown fences', function () {
    assert.strictEqual(sanitizeLLMResponse('```bash\nnpm test\n```'), 'npm test');
  });

  it('should reject response longer than 500 chars', function () {
    assert.strictEqual(sanitizeLLMResponse('x'.repeat(501)), null);
  });

  it('should reject multi-line prose', function () {
    assert.strictEqual(sanitizeLLMResponse('First run this.\nThen run that.'), null);
  });

  it('should accept valid command chain', function () {
    assert.strictEqual(sanitizeLLMResponse('npm run lint && npm test'), 'npm run lint && npm test');
  });

  it('should return null for empty input', function () {
    assert.strictEqual(sanitizeLLMResponse(''), null);
    assert.strictEqual(sanitizeLLMResponse(null), null);
  });

  it('should strip inline backticks', function () {
    assert.strictEqual(sanitizeLLMResponse('`npm test`'), 'npm test');
  });

  it('should strip leading $ prompt', function () {
    assert.strictEqual(sanitizeLLMResponse('$ npm test'), 'npm test');
  });

  it('should strip inline backticks and leading $ combined', function () {
    assert.strictEqual(
      sanitizeLLMResponse('`$ npm run lint && npm test`'),
      'npm run lint && npm test'
    );
  });
});

describe('buildProjectContext', function () {
  let tmpDir;

  beforeEach(function () {
    tmpDir = makeTmpDir();
  });

  afterEach(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should include file listing', function () {
    writeFile(tmpDir, 'package.json', '{}');
    writeFile(tmpDir, 'index.js', '');
    const context = buildProjectContext(tmpDir);
    assert.ok(context.includes('package.json'));
    assert.ok(context.includes('index.js'));
  });

  it('should include ecosystem file contents', function () {
    writeFile(tmpDir, 'package.json', '{"name":"test"}');
    const context = buildProjectContext(tmpDir);
    assert.ok(context.includes('--- package.json ---'));
    assert.ok(context.includes('"name":"test"'));
  });

  it('should truncate large files', function () {
    writeFile(tmpDir, 'package.json', 'x'.repeat(5000));
    const context = buildProjectContext(tmpDir);
    assert.ok(context.includes('...(truncated)'));
  });
});

describe('buildCLIArgs', function () {
  it('should return correct args for claude', function () {
    const args = buildCLIArgs('claude', 'test prompt');
    assert.deepStrictEqual(args, ['--print', '--output-format', 'text', 'test prompt']);
  });

  it('should return correct args for codex', function () {
    const args = buildCLIArgs('codex', 'test prompt');
    assert.deepStrictEqual(args, ['exec', '--skip-git-repo-check', 'test prompt']);
  });

  it('should return correct args for gemini', function () {
    const args = buildCLIArgs('gemini', 'test prompt');
    assert.deepStrictEqual(args, ['-p', 'test prompt']);
  });

  it('should return correct args for opencode', function () {
    const args = buildCLIArgs('opencode', 'test prompt');
    assert.deepStrictEqual(args, ['run', 'test prompt']);
  });

  it('should return null for unknown binary', function () {
    assert.strictEqual(buildCLIArgs('unknown', 'test'), null);
  });
});

describe('detectWithLLM', function () {
  let commandExistsStub;

  afterEach(function () {
    if (commandExistsStub) {
      commandExistsStub.restore();
      commandExistsStub = null;
    }
  });

  it('should return null when provider binary not found', function () {
    const providerDetection = require('../lib/provider-detection');
    commandExistsStub = sinon.stub(providerDetection, 'commandExists').returns(false);

    const { detectWithLLM } = require('../lib/quality-detection');
    const result = detectWithLLM('/some/path', 'claude');
    assert.strictEqual(result, null);
  });
});
