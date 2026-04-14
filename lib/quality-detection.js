/**
 * Quality detection — detect project ecosystem and generate quality gate commands.
 *
 * Heuristic detection (pure filesystem) with LLM fallback for unrecognised projects.
 * Stores results in ~/.zeroshot/projects/ via project-config module.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const QUALITY_FILE = '.zeroshot-quality';

// Detection source constants
const SOURCE_HEURISTIC = 'heuristic';
const SOURCE_LLM = 'llm';
const SOURCE_HEURISTIC_FAILED = 'heuristic-failed';
const SOURCE_LLM_FAILED = 'llm-failed';

// Provider binary mapping (avoids lib/ → src/ dependency)
const PROVIDER_BINARIES = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

// Key ecosystem files to include in LLM context
const ECOSYSTEM_FILES = [
  'package.json',
  'Makefile',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  'deno.json',
  'pubspec.yaml',
  'build.sbt',
  'Package.swift',
  'global.json',
  'Pipfile',
  'setup.py',
  'meson.build',
  'tsconfig.json',
];

/**
 * Check if a file exists in the project directory.
 * @param {string} dir - Project root
 * @param {string} file - Relative file path
 * @returns {boolean}
 */
function exists(dir, file) {
  return fs.existsSync(path.join(dir, file));
}

/**
 * Check if a file contains a string (case-insensitive), matching bash `grep -qi`.
 * @param {string} dir - Project root
 * @param {string} file - Relative file path
 * @param {string} needle - String to search for (case-insensitive)
 * @returns {boolean}
 */
function has(dir, file, needle) {
  try {
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    return content.toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Check if any file matching a glob-like pattern exists (simple suffix match).
 * @param {string} dir - Project root
 * @param {string} suffix - File extension or suffix (e.g. '.sln', '.rockspec')
 * @returns {boolean}
 */
function hasFilesWithSuffix(dir, suffix) {
  try {
    const entries = fs.readdirSync(dir);
    return entries.some((e) => e.endsWith(suffix));
  } catch {
    return false;
  }
}

/**
 * Check if a Makefile has a specific target.
 * @param {string} dir - Project root
 * @param {string} target - Make target name
 * @returns {boolean}
 */
function makefileHasTarget(dir, target) {
  try {
    const content = fs.readFileSync(path.join(dir, 'Makefile'), 'utf-8');
    return new RegExp(`^${target}:`, 'm').test(content);
  } catch {
    return false;
  }
}

/**
 * Detect quality gate command from project files.
 *
 * Each ecosystem block is independent (not else-if) so multi-ecosystem
 * projects (e.g. PHP backend + Node frontend) get full coverage.
 *
 * @param {string} projectDir - Absolute path to project root
 * @returns {{ command: string|null, ecosystems: string[] }}
 */
function detectQualityCommand(projectDir) {
  const parts = [];
  const ecosystems = [];

  // ─── PHP ─────────────────────────────────────────────────────────
  if (exists(projectDir, 'composer.json')) {
    ecosystems.push('php');
    if (exists(projectDir, 'vendor/bin/phpstan')) {
      parts.push('vendor/bin/phpstan analyse');
    }
    if (has(projectDir, 'composer.json', 'laravel/framework')) {
      parts.push('php artisan test');
    } else if (has(projectDir, 'composer.json', '"symfony/"')) {
      parts.push('php bin/phpunit');
    } else if (exists(projectDir, 'vendor/bin/phpunit')) {
      parts.push('vendor/bin/phpunit');
    }
  }

  // ─── Ruby ────────────────────────────────────────────────────────
  if (exists(projectDir, 'Gemfile')) {
    ecosystems.push('ruby');
    if (has(projectDir, 'Gemfile', 'rubocop')) {
      parts.push('bundle exec rubocop');
    }
    if (exists(projectDir, 'bin/rails') || has(projectDir, 'Gemfile', 'rails')) {
      parts.push('bin/rails test');
    } else if (has(projectDir, 'Gemfile', 'rspec')) {
      parts.push('bundle exec rspec');
    } else {
      parts.push('bundle exec rake test');
    }
  }

  // ─── Python ──────────────────────────────────────────────────────
  if (
    exists(projectDir, 'pyproject.toml') ||
    exists(projectDir, 'requirements.txt') ||
    exists(projectDir, 'setup.py') ||
    exists(projectDir, 'Pipfile') ||
    exists(projectDir, 'poetry.lock')
  ) {
    ecosystems.push('python');
    // Linting
    if (exists(projectDir, 'pyproject.toml') && has(projectDir, 'pyproject.toml', '[tool.ruff]')) {
      parts.push('ruff check .');
    } else if (exists(projectDir, '.flake8') || exists(projectDir, 'setup.cfg')) {
      parts.push('flake8 .');
    }
    // Type checking
    if (
      exists(projectDir, 'mypy.ini') ||
      (exists(projectDir, 'pyproject.toml') && has(projectDir, 'pyproject.toml', '[tool.mypy]'))
    ) {
      parts.push('mypy .');
    }
    // Testing
    if (exists(projectDir, 'manage.py')) {
      parts.push('python manage.py check', 'python manage.py test');
    } else {
      parts.push('python -m pytest');
    }
  }

  // ─── Java / Kotlin ──────────────────────────────────────────────
  if (exists(projectDir, 'pom.xml')) {
    ecosystems.push('java');
    if (exists(projectDir, 'mvnw')) {
      parts.push('./mvnw test');
    } else {
      parts.push('mvn test');
    }
  } else if (exists(projectDir, 'build.gradle') || exists(projectDir, 'build.gradle.kts')) {
    ecosystems.push('java');
    if (exists(projectDir, 'gradlew')) {
      parts.push('./gradlew test');
      if (
        has(projectDir, 'build.gradle', 'com.android.application') ||
        has(projectDir, 'build.gradle.kts', 'com.android.application')
      ) {
        parts.push('./gradlew lint');
      }
    } else {
      parts.push('gradle test');
    }
  }

  // ─── Node.js / TypeScript ───────────────────────────────────────
  // Checked after backend ecosystems so backend tests come first in the chain.
  if (exists(projectDir, 'package.json')) {
    // Detect package manager
    let pkgRun = 'npm run';
    let pkgTest = 'npm test';
    if (exists(projectDir, 'bun.lockb') || exists(projectDir, 'bunfig.toml')) {
      pkgRun = 'bun run';
      pkgTest = 'bun test';
    } else if (exists(projectDir, 'pnpm-lock.yaml')) {
      pkgRun = 'pnpm run';
      pkgTest = 'pnpm test';
    } else if (exists(projectDir, 'yarn.lock')) {
      pkgRun = 'yarn';
      pkgTest = 'yarn test';
    }

    const nodeParts = [];

    // Prefer explicit npm scripts (most reliable — user configured these)
    if (has(projectDir, 'package.json', '"lint"')) {
      nodeParts.push(`${pkgRun} lint`);
    }
    if (has(projectDir, 'package.json', '"typecheck"')) {
      nodeParts.push(`${pkgRun} typecheck`);
    }
    if (has(projectDir, 'package.json', '"check"')) {
      nodeParts.push(`${pkgRun} check`);
    }
    if (has(projectDir, 'package.json', '"test"')) {
      nodeParts.push(`${pkgTest}`);
    }
    if (has(projectDir, 'package.json', '"build"')) {
      nodeParts.push(`${pkgRun} build`);
    }

    // If no scripts found, detect from tooling config files
    if (nodeParts.length === 0) {
      // Linting
      if (
        hasFilesWithSuffix(projectDir, '.eslintrc') ||
        has(projectDir, 'package.json', '"eslint"')
      ) {
        nodeParts.push('npx eslint .');
      }
      // Type checking
      if (exists(projectDir, 'tsconfig.json')) {
        nodeParts.push('npx tsc --noEmit');
      }
      // Test runners (pick one)
      if (
        exists(projectDir, 'vitest.config.js') ||
        exists(projectDir, 'vitest.config.ts') ||
        has(projectDir, 'package.json', '"vitest"')
      ) {
        nodeParts.push('npx vitest run');
      } else if (
        exists(projectDir, 'jest.config.js') ||
        exists(projectDir, 'jest.config.ts') ||
        exists(projectDir, 'jest.config.cjs') ||
        has(projectDir, 'package.json', '"jest"')
      ) {
        nodeParts.push('npx jest');
      } else if (
        exists(projectDir, '.mocharc.js') ||
        exists(projectDir, '.mocharc.json') ||
        exists(projectDir, '.mocharc.yaml') ||
        has(projectDir, 'package.json', '"mocha"')
      ) {
        nodeParts.push('npx mocha');
      } else if (
        exists(projectDir, 'playwright.config.js') ||
        exists(projectDir, 'playwright.config.ts')
      ) {
        nodeParts.push('npx playwright test');
      } else if (
        exists(projectDir, 'cypress.config.js') ||
        exists(projectDir, 'cypress.config.ts') ||
        has(projectDir, 'package.json', '"cypress"')
      ) {
        nodeParts.push('npx cypress run');
      }
      // Framework-specific build checks
      if (
        exists(projectDir, 'next.config.js') ||
        exists(projectDir, 'next.config.mjs') ||
        exists(projectDir, 'next.config.ts') ||
        has(projectDir, 'package.json', '"next"')
      ) {
        nodeParts.push('npx next build');
      } else if (
        exists(projectDir, 'nuxt.config.js') ||
        exists(projectDir, 'nuxt.config.ts') ||
        has(projectDir, 'package.json', '"nuxt"')
      ) {
        nodeParts.push('npx nuxi build');
      } else if (
        exists(projectDir, 'angular.json') ||
        has(projectDir, 'package.json', '"@angular/core"')
      ) {
        nodeParts.push('npx ng build');
      } else if (
        exists(projectDir, 'astro.config.mjs') ||
        exists(projectDir, 'astro.config.js') ||
        exists(projectDir, 'astro.config.ts') ||
        has(projectDir, 'package.json', '"astro"')
      ) {
        nodeParts.push('npx astro build');
      } else if (
        exists(projectDir, 'vite.config.js') ||
        exists(projectDir, 'vite.config.ts') ||
        exists(projectDir, 'vite.config.mjs')
      ) {
        nodeParts.push('npx vite build');
      }
    }

    if (nodeParts.length > 0) {
      ecosystems.push('node');
      parts.push(...nodeParts);
    }
  } else if (exists(projectDir, 'deno.json') || exists(projectDir, 'deno.jsonc')) {
    ecosystems.push('deno');
    parts.push('deno lint', 'deno test');
  }

  // ─── Rust ────────────────────────────────────────────────────────
  if (exists(projectDir, 'Cargo.toml')) {
    ecosystems.push('rust');
    parts.push('cargo clippy -- -D warnings', 'cargo test');
  }

  // ─── Go ──────────────────────────────────────────────────────────
  if (exists(projectDir, 'go.mod')) {
    ecosystems.push('go');
    parts.push('go vet ./...', 'go test ./...');
  }

  // ─── C# / .NET ──────────────────────────────────────────────────
  // Only if nothing detected yet (same guard as bash version)
  if (ecosystems.length === 0) {
    if (
      hasFilesWithSuffix(projectDir, '.sln') ||
      hasFilesWithSuffix(projectDir, '.csproj') ||
      exists(projectDir, 'global.json')
    ) {
      ecosystems.push('dotnet');
      parts.push('dotnet build', 'dotnet test');
    }
  }

  // ─── Swift ───────────────────────────────────────────────────────
  if (ecosystems.length === 0) {
    if (exists(projectDir, 'Package.swift')) {
      ecosystems.push('swift');
      parts.push('swift build', 'swift test');
    }
  }

  // ─── Dart / Flutter ──────────────────────────────────────────────
  if (ecosystems.length === 0) {
    if (exists(projectDir, 'pubspec.yaml')) {
      ecosystems.push('dart');
      parts.push('dart analyze', 'dart test');
    }
  }

  // ─── Scala ───────────────────────────────────────────────────────
  if (ecosystems.length === 0) {
    if (exists(projectDir, 'build.sbt')) {
      ecosystems.push('scala');
      parts.push('sbt compile', 'sbt test');
    } else if (exists(projectDir, 'build.sc')) {
      ecosystems.push('scala');
      parts.push('mill compile', 'mill test');
    }
  }

  // ─── R ───────────────────────────────────────────────────────────
  if (ecosystems.length === 0) {
    if (
      exists(projectDir, 'DESCRIPTION') ||
      hasFilesWithSuffix(projectDir, '.Rproj') ||
      exists(projectDir, 'renv.lock')
    ) {
      ecosystems.push('r');
      parts.push('R CMD check .');
    }
  }

  // ─── Lua ─────────────────────────────────────────────────────────
  if (ecosystems.length === 0) {
    if (hasFilesWithSuffix(projectDir, '.rockspec')) {
      ecosystems.push('lua');
      parts.push('luacheck .');
    }
  }

  // ─── C/C++ build systems ─────────────────────────────────────────
  if (ecosystems.length === 0) {
    if (exists(projectDir, 'CMakeLists.txt')) {
      ecosystems.push('cpp');
      parts.push('cmake -B build && cmake --build build && ctest --test-dir build');
    } else if (exists(projectDir, 'meson.build')) {
      ecosystems.push('cpp');
      parts.push('meson setup build && meson compile -C build && meson test -C build');
    } else if (exists(projectDir, 'WORKSPACE') || exists(projectDir, 'BUILD.bazel')) {
      ecosystems.push('cpp');
      parts.push('bazel build //...', 'bazel test //...');
    } else if (exists(projectDir, 'Makefile')) {
      ecosystems.push('cpp');
      if (makefileHasTarget(projectDir, 'lint')) {
        parts.push('make lint');
      }
      if (makefileHasTarget(projectDir, 'test')) {
        parts.push('make test');
      } else if (makefileHasTarget(projectDir, 'check')) {
        parts.push('make check');
      } else {
        parts.push('make');
      }
    }
  }

  if (parts.length === 0) {
    return { command: null, ecosystems };
  }

  return { command: parts.join(' && '), ecosystems };
}

// ─── LLM Detection ─────────────────────────────────────────────────

/**
 * Build context string from project files for LLM prompt.
 * Lists root-level files and includes contents of key ecosystem files (truncated).
 * @param {string} projectDir
 * @returns {string}
 */
function buildProjectContext(projectDir) {
  const parts = [];

  // Root file listing
  try {
    const entries = fs.readdirSync(projectDir);
    parts.push('Files in project root:\n' + entries.join('\n'));
  } catch {
    parts.push('(could not list project root)');
  }

  // Key ecosystem file contents
  for (const file of ECOSYSTEM_FILES) {
    const filePath = path.join(projectDir, file);
    try {
      if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf-8');
        if (content.length > 3000) {
          content = content.slice(0, 3000) + '\n...(truncated)';
        }
        parts.push(`\n--- ${file} ---\n${content}`);
      }
    } catch {
      // skip unreadable files
    }
  }

  return parts.join('\n');
}

/**
 * Build CLI args for headless invocation per provider.
 * @param {string} binary - CLI binary name
 * @param {string} prompt - The prompt text
 * @returns {string[]|null} Args array, or null if unknown binary
 */
function buildCLIArgs(binary, prompt) {
  switch (binary) {
    case 'claude':
      return ['--print', '--output-format', 'text', prompt];
    case 'codex':
      return ['exec', '--skip-git-repo-check', prompt];
    case 'gemini':
      return ['-p', prompt];
    case 'opencode':
      return ['run', prompt];
    default:
      return null;
  }
}

/**
 * Invoke a CLI binary with a prompt in headless mode.
 * @param {string} binary - CLI binary name
 * @param {string} prompt - Prompt text
 * @returns {string|null} CLI response text, or null on failure
 */
function invokeCLI(binary, prompt) {
  const args = buildCLIArgs(binary, prompt);
  if (!args) return null;

  const result = spawnSync(binary, args, {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim();
}

/**
 * Sanitize LLM response — reject anything that doesn't look like a shell command.
 * @param {string} response
 * @returns {string|null}
 */
function sanitizeLLMResponse(response) {
  if (!response) return null;

  // Strip markdown fences
  let cleaned = response
    .replace(/^```[a-z]*\n?/gm, '')
    .replace(/^```$/gm, '')
    .trim();

  // Reject if too long (likely prose, not a command)
  if (cleaned.length > 500) return null;

  // Reject multi-line prose (commands joined with && are single-line)
  const lines = cleaned.split('\n').filter((l) => l.trim());
  if (lines.length > 1) return null;

  cleaned = lines[0].trim();

  // Strip inline backticks: `command` → command
  cleaned = cleaned.replace(/^`(.*)`$/, '$1').trim();
  // Strip leading $ prompt: $ npm test → npm test
  cleaned = cleaned.replace(/^\$\s+/, '').trim();

  // Reject empty
  if (!cleaned) return null;

  return cleaned;
}

/**
 * Use an LLM to detect the quality gate command for a project.
 * @param {string} projectDir - Absolute path to project root
 * @param {string} provider - Provider name (claude, codex, gemini, opencode)
 * @returns {string|null} Detected command or null
 */
function detectWithLLM(projectDir, provider) {
  const { commandExists } = require('./provider-detection');

  const binary = PROVIDER_BINARIES[provider];
  if (!binary || !commandExists(binary)) return null;

  const context = buildProjectContext(projectDir);
  const prompt =
    'Given this project, output a single shell command chain (using &&) that runs ' +
    "the project's linter and tests. Output ONLY the command, nothing else. " +
    'Do not wrap in backticks or markdown formatting. ' +
    'If you cannot determine a quality gate command, output exactly: NONE\n\n' +
    context;

  const response = invokeCLI(binary, prompt);
  if (!response || response.trim() === 'NONE') return null;

  return sanitizeLLMResponse(response);
}

// ─── Ensure Quality Config ──────────────────────────────────────────

/**
 * Ensure quality config is set up for a project.
 * Stores config in ~/.zeroshot/projects/ (never writes to user's project directory).
 *
 * Read priority:
 *   1. .zeroshot-quality in project root → manual override, skip
 *   2. Project config with valid source → already configured, skip
 *   3. Project config with source=heuristic-failed → re-detect (LLM first, then heuristic)
 *   4. No config → detect (heuristic first, then LLM fallback)
 *
 * @param {string} projectDir - Absolute path to project root
 * @returns {{ created: boolean, command: string|null }}
 */
function ensureQualityConfig(projectDir) {
  const { loadProjectConfig, saveProjectConfig } = require('./project-config');

  // 1. Manual override — .zeroshot-quality in project root
  if (fs.existsSync(path.join(projectDir, QUALITY_FILE))) {
    return { created: false, command: null };
  }

  // 2. Check existing project config
  const existing = loadProjectConfig(projectDir);
  if (
    existing &&
    existing.source &&
    existing.source !== SOURCE_HEURISTIC_FAILED &&
    existing.source !== SOURCE_LLM_FAILED
  ) {
    // Retroactively sanitize LLM-sourced commands (may contain backticks from pre-fix detection)
    if (existing.source === SOURCE_LLM && existing.qualityCommand) {
      const sanitized = sanitizeLLMResponse(existing.qualityCommand);
      if (sanitized && sanitized !== existing.qualityCommand) {
        saveProjectConfig(projectDir, {
          ...existing,
          qualityCommand: sanitized,
          updatedAt: new Date().toISOString(),
        });
      }
      if (!sanitized) {
        // Sanitization nullified command — mark as failed, fall through to re-detection
        saveProjectConfig(projectDir, {
          ...existing,
          qualityCommand: null,
          source: SOURCE_LLM_FAILED,
          updatedAt: new Date().toISOString(),
        });
      } else {
        return { created: false, command: null };
      }
    } else {
      return { created: false, command: null };
    }
  }

  let command = null;
  let source = null;
  let ecosystems = [];

  if (
    existing &&
    (existing.source === SOURCE_HEURISTIC_FAILED || existing.source === SOURCE_LLM_FAILED)
  ) {
    // 3. Re-detect: try LLM first (heuristic already failed), then heuristic retry
    const settings = require('./settings').loadSettings();
    const provider = settings.defaultProvider || 'claude';
    command = detectWithLLM(projectDir, provider);
    if (command) {
      source = SOURCE_LLM;
    } else {
      const detected = detectQualityCommand(projectDir);
      if (detected.command) {
        command = detected.command;
        source = SOURCE_HEURISTIC;
        ecosystems = detected.ecosystems;
      }
    }
  } else {
    // 4. Fresh detection: heuristic first, LLM fallback
    const detected = detectQualityCommand(projectDir);
    if (detected.command) {
      command = detected.command;
      source = SOURCE_HEURISTIC;
      ecosystems = detected.ecosystems;
    } else {
      const settings = require('./settings').loadSettings();
      const provider = settings.defaultProvider || 'claude';
      command = detectWithLLM(projectDir, provider);
      if (command) {
        source = SOURCE_LLM;
      }
    }
  }

  if (command && source) {
    saveProjectConfig(projectDir, {
      qualityCommand: command,
      source,
      ecosystems,
      updatedAt: new Date().toISOString(),
    });
    return { created: true, command };
  }

  // Nothing detected — record heuristic-failed so LLM is tried next time
  if (
    !existing ||
    (existing.source !== SOURCE_HEURISTIC_FAILED && existing.source !== SOURCE_LLM_FAILED)
  ) {
    saveProjectConfig(projectDir, {
      qualityCommand: null,
      source: SOURCE_HEURISTIC_FAILED,
      ecosystems: [],
      updatedAt: new Date().toISOString(),
    });
  }

  return { created: false, command: null };
}

module.exports = {
  detectQualityCommand,
  ensureQualityConfig,
  QUALITY_FILE,
  SOURCE_HEURISTIC,
  SOURCE_LLM,
  SOURCE_HEURISTIC_FAILED,
  SOURCE_LLM_FAILED,
  // Exported for testing
  buildProjectContext,
  buildCLIArgs,
  invokeCLI,
  sanitizeLLMResponse,
  detectWithLLM,
};
