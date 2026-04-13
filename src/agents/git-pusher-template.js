/**
 * Git Pusher Agent Template
 *
 * Generates platform-specific git-pusher agent configurations.
 * Eliminates duplication across github/gitlab/azure JSON files.
 *
 * Single source of truth for:
 * - Trigger logic (validation consensus detection)
 * - Agent structure (id, role, modelLevel, output)
 * - Prompt template with platform-specific commands
 */

/**
 * Shared trigger logic for detecting when all validators have approved.
 * This is the SINGLE source of truth - no more duplicating across 3 JSON files.
 */
const SHARED_TRIGGER_SCRIPT = `const validators = cluster.getAgentsByRole('validator');
const lastPush = ledger.findLast({ topic: 'IMPLEMENTATION_READY' });
if (!lastPush) return false;
if (validators.length === 0) return true;

const results = ledger.query({ topic: 'VALIDATION_RESULT', since: lastPush.timestamp });
if (results.length === 0) return false;

const validatorIds = new Set(validators.map((v) => v.id));
const validatorResults = results.filter((r) => validatorIds.has(r.sender));

// Two supported patterns:
// 1) Per-validator VALIDATION_RESULT (sender is a validator) → require all validators approve.
// 2) Consensus-only VALIDATION_RESULT (sender is coordinator) → treat latest result as final.
if (validatorResults.length === 0) {
  let latest = null;
  for (const msg of results) {
    if (!latest || (typeof msg.timestamp === 'number' && msg.timestamp > latest.timestamp)) {
      latest = msg;
    }
  }
  const approved = latest?.content?.data?.approved;
  return approved === true || approved === 'true';
}

const latestByValidator = new Map();
for (const msg of validatorResults) {
  latestByValidator.set(msg.sender, msg);
}
if (latestByValidator.size < validators.length) return false;

for (const validator of validators) {
  const msg = latestByValidator.get(validator.id);
  const approved = msg?.content?.data?.approved;
  if (!(approved === true || approved === 'true')) return false;
}

const hasSufficientEvidence = Array.from(latestByValidator.values()).every((r) => {
  const criteria = r.content?.data?.criteriaResults;
  if (!Array.isArray(criteria) || criteria.length === 0) return true;
  return criteria.every((c) => {
    const status = String(c.status || '').toUpperCase();
    if (status === 'CANNOT_VALIDATE') return true;
    if (status === 'SKIPPED') return true;
    if (status === 'CANNOT_VALIDATE_YET') return false;
    const evidence = c.evidence || {};
    const hasCommand = typeof evidence.command === 'string' && evidence.command.trim().length > 0;
    const exitCode = evidence.exitCode;
    const hasExitCode =
      typeof exitCode === 'number' ||
      (typeof exitCode === 'string' && exitCode.trim() !== '' && Number.isFinite(Number(exitCode)));
    const hasOutput = evidence.output === undefined || typeof evidence.output === 'string';
    return hasCommand && hasExitCode && hasOutput;
  });
});

return hasSufficientEvidence;`;

const { readRepoSettings } = require('../../lib/repo-settings');

function getSafeBranchName(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Conservative allowlist to avoid shell injection in generated CLI commands.
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function parseBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '1' || trimmed === 'true' || trimmed === 'yes') return true;
  if (trimmed === '0' || trimmed === 'false' || trimmed === 'no') return false;
  return null;
}

function normalizeCloseIssueMode(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'auto') return 'auto';
  if (trimmed === 'always') return 'always';
  if (trimmed === 'never') return 'never';
  return null;
}

/**
 * Resolve GitHub configuration from CLI options and repo settings.
 * Priority: CLI options > repo settings (.zeroshot/settings.json) > defaults
 *
 * @param {Object} options - CLI options
 * @param {string} [options.prBase] - Target branch for PRs
 * @param {boolean} [options.mergeQueue] - Use GitHub merge queue
 * @param {string} [options.closeIssue] - When to close issue: auto|always|never
 * @returns {Object} Resolved configuration
 */
function resolveGitHubConfig(options = {}) {
  const repoSettingsResult = readRepoSettings(process.cwd());
  const repoSettings = repoSettingsResult.settings || {};
  const repoGithub = repoSettings.github || {};

  // CLI options override repo settings
  const prBase = getSafeBranchName(options.prBase) || getSafeBranchName(repoGithub.prBase);

  const useMergeQueue =
    options.mergeQueue === true ||
    (options.mergeQueue !== false && parseBool(repoGithub.useMergeQueue) === true);

  const closeIssueMode =
    normalizeCloseIssueMode(options.closeIssue) ||
    normalizeCloseIssueMode(repoGithub.closeIssue) ||
    (parseBool(repoGithub.closeIssue) === true ? 'always' : null) ||
    'never';

  return { prBase, useMergeQueue, closeIssueMode };
}

/**
 * Generate platform-specific configuration based on resolved GitHub config.
 *
 * @param {string} platform - Platform ID ('github', 'gitlab', 'azure-devops')
 * @param {Object} config - Resolved GitHub config from resolveGitHubConfig()
 * @returns {Object|null} Platform configuration or null if unsupported
 */
function getPlatformConfig(platform, config = {}) {
  const { prBase, useMergeQueue, closeIssueMode } = config;

  const PLATFORM_CONFIGS = {
    github: {
      prName: 'PR',
      prNameLower: 'pull request',
      createCmd: `gh pr create${prBase ? ` --base ${prBase}` : ''} --title "feat: {{issue_title}}" --body "Closes #{{issue_number}}"`,
      mergeCmd: useMergeQueue
        ? `PR_ID="$(gh pr view --json id --jq .id)"
gh api graphql -f query='mutation($id:ID!){enqueuePullRequest(input:{pullRequestId:$id}){mergeQueueEntry{state}}}' -f id="$PR_ID"
echo "Waiting for merge..."
until gh pr view --json mergedAt --jq .mergedAt | grep -q .; do
  sleep 20
done`
        : 'gh pr merge --merge --auto',
      mergeFallbackCmd: useMergeQueue ? 'gh pr merge --merge --auto' : 'gh pr merge --merge',
      prUrlExample: 'https://github.com/owner/repo/pull/123',
      outputFields: { urlField: 'pr_url', numberField: 'pr_number', mergedField: 'merged' },
      rebaseBranch: prBase || 'main',
      usesMergeQueue: useMergeQueue,
      closeIssueMode: closeIssueMode || 'never',
    },
    gitlab: {
      prName: 'MR',
      prNameLower: 'merge request',
      createCmd:
        'glab mr create --title "feat: {{issue_title}}" --description "Closes #{{issue_number}}"',
      mergeCmd: 'glab mr merge --auto-merge',
      mergeFallbackCmd: 'glab mr merge',
      prUrlExample: 'https://gitlab.com/owner/repo/-/merge_requests/123',
      outputFields: { urlField: 'mr_url', numberField: 'mr_number', mergedField: 'merged' },
      closeIssueMode: closeIssueMode || 'never',
    },
    'azure-devops': {
      prName: 'PR',
      prNameLower: 'pull request',
      createCmd:
        'az repos pr create --title "feat: {{issue_title}}" --description "Closes #{{issue_number}}"',
      mergeCmd: 'az repos pr update --id <PR_ID> --auto-complete true',
      mergeFallbackCmd: 'az repos pr update --id <PR_ID> --status completed',
      prUrlExample: 'https://dev.azure.com/org/project/_git/repo/pullrequest/123',
      outputFields: {
        urlField: 'pr_url',
        numberField: 'pr_number',
        mergedField: 'merged',
        autoCompleteField: 'auto_complete',
      },
      // Azure requires extracting PR ID from create output
      requiresPrIdExtraction: true,
      closeIssueMode: closeIssueMode || 'never',
    },
  };

  return PLATFORM_CONFIGS[platform] || null;
}

/**
 * Get list of supported platforms for git-pusher
 * @returns {string[]} Array of platform IDs
 */
const SUPPORTED_PLATFORMS = ['github', 'gitlab', 'azure-devops'];

/**
 * Generate the prompt for a specific platform
 * @param {Object} config - Platform configuration from PLATFORM_CONFIGS
 * @returns {string} The complete prompt with platform-specific commands
 */
function generatePrompt(config) {
  const {
    prName,
    prNameLower,
    createCmd,
    mergeCmd,
    mergeFallbackCmd,
    prUrlExample,
    outputFields,
    requiresPrIdExtraction,
    rebaseBranch,
    usesMergeQueue,
    closeIssueMode,
  } = config;

  const azurePrIdNote = requiresPrIdExtraction
    ? `\n\nOutput contains PR ID. Extract it for step 6 — look for "Created PR 123" or parse URL.`
    : '';

  const mergeDescription = requiresPrIdExtraction
    ? 'SET AUTO-COMPLETE'
    : usesMergeQueue
      ? `ENQUEUE INTO MERGE QUEUE AND WAIT UNTIL MERGED`
      : `MERGE THE ${prName}`;

  const mergeExplanation = requiresPrIdExtraction
    ? `Replace <PR_ID> with actual PR number from step 5. Enables auto-complete (merges when CI passes).

If auto-complete unavailable:`
    : usesMergeQueue
      ? `Enqueues ${prName} into merge queue and waits until merged.

If enqueue fails, fall back:`
      : `Sets auto-merge. If it fails, try:`;

  const postMergeStatus = requiresPrIdExtraction
    ? 'PR IS CREATED AND AUTO-COMPLETE IS SET'
    : `${prName} IS MERGED`;

  const finalOutputNote = requiresPrIdExtraction
    ? `ONLY after PR created and auto-complete set:
\`\`\`json
{"${outputFields.urlField}": "${prUrlExample}", "${outputFields.numberField}": 123, "merged": false, "auto_complete": true}
\`\`\`

No changes:
\`\`\`json
{"${outputFields.urlField}": null, "${outputFields.numberField}": null, "merged": false, "auto_complete": false}
\`\`\``
    : `ONLY after ${prName} is MERGED:
\`\`\`json
{"${outputFields.urlField}": "${prUrlExample}", "${outputFields.numberField}": 123, "merged": true}
\`\`\`

No changes:
\`\`\`json
{"${outputFields.urlField}": null, "${outputFields.numberField}": null, "merged": false}
\`\`\``;

  return `ALL VALIDATORS APPROVED. Create ${prName} and merge. Do not stop until ${postMergeStatus}.

## Steps — execute in order

### 1: Stage changes
\`\`\`bash
git add -A
\`\`\`

### 2: Check staged
\`\`\`bash
git status
\`\`\`
Nothing to commit → output JSON with ${outputFields.urlField}: null and stop.

### 3: Commit
\`\`\`bash
git commit -m "feat: implement #{{issue_number}} - {{issue_title}}"
\`\`\`

### 4: Push
\`\`\`bash
git push -u origin HEAD
\`\`\`
Do NOT stop here. Continue to step 5.

### 5: Create ${prName}
\`\`\`bash
${createCmd}
\`\`\`
Run \`${createCmd.split(' ').slice(0, 3).join(' ')}\`. Ignore push output link — that is NOT a ${prNameLower}.${requiresPrIdExtraction ? '' : ` Save actual ${prName} URL from output.`}${azurePrIdNote}
Do NOT stop here. Continue to step 6.

### 6: ${mergeDescription} (MANDATORY)
\`\`\`bash
${mergeCmd}
\`\`\`
${mergeExplanation}
\`\`\`bash
${mergeFallbackCmd}
\`\`\`

If merge fails due to conflicts:
1. \`git fetch origin ${rebaseBranch || 'main'} && git rebase origin/${rebaseBranch || 'main'}\`
2. Resolve conflicts, \`git add <resolved-files>\`, \`git rebase --continue\`
3. \`git push --force-with-lease\`
4. Retry: \`${mergeFallbackCmd}\`

Repeat until merged. Do not give up.${requiresPrIdExtraction ? ' Auto-complete merges when CI passes.' : ' If blocked by CI, wait and retry. If blocked by reviews, set auto-merge.'}

${
  closeIssueMode !== 'never'
    ? `### 7: Close issue
\`\`\`bash
if [ "{{issue_number}}" != "unknown" ]; then
  ISSUE_STATE="$(gh issue view {{issue_number}} --json state --jq .state 2>/dev/null || true)"
  if [ "$ISSUE_STATE" = "OPEN" ]; then
    BASE_BRANCH="${rebaseBranch || 'main'}"
    DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null || true)"
    SHOULD_CLOSE="0"
    if [ "${closeIssueMode}" = "always" ]; then
      SHOULD_CLOSE="1"
    elif [ "${closeIssueMode}" = "auto" ]; then
      if [ -z "$DEFAULT_BRANCH" ] || [ "$BASE_BRANCH" != "$DEFAULT_BRANCH" ]; then
        SHOULD_CLOSE="1"
      fi
    fi

    if [ "$SHOULD_CLOSE" = "1" ]; then
  PR_URL="$(gh pr view --json url --jq .url 2>/dev/null || true)"
  if [ -n "$PR_URL" ]; then
    gh issue close {{issue_number}} --comment "Implemented in $PR_URL"
  else
    gh issue close {{issue_number}} --comment "Implemented"
  fi
    fi
  fi
fi
\`\`\`
Only after ${prName} is merged.`
    : ''
}

## Output
DO NOT output JSON until ${postMergeStatus}.
${finalOutputNote}`;
}

/**
 * Generate a git-pusher agent configuration for a specific platform
 *
 * @param {string} platform - Platform ID ('github', 'gitlab', 'azure-devops')
 * @param {Object} [options] - CLI options for GitHub configuration
 * @param {string} [options.prBase] - Target branch for PRs
 * @param {boolean} [options.mergeQueue] - Use GitHub merge queue
 * @param {string} [options.closeIssue] - When to close issue: auto|always|never
 * @returns {Object} Agent configuration object
 * @throws {Error} If platform is not supported
 */
function generateGitPusherAgent(platform, options = {}) {
  // Resolve config from CLI options and repo settings
  const resolvedConfig = resolveGitHubConfig(options);
  const platformConfig = getPlatformConfig(platform, resolvedConfig);

  if (!platformConfig) {
    const supported = SUPPORTED_PLATFORMS.join(', ');
    throw new Error(`Unsupported platform '${platform}'. Supported: ${supported}`);
  }

  return {
    id: 'git-pusher',
    role: 'completion-detector',
    modelLevel: 'level2',
    triggers: [
      {
        topic: 'VALIDATION_RESULT',
        logic: {
          engine: 'javascript',
          script: SHARED_TRIGGER_SCRIPT,
        },
        action: 'execute_task',
      },
    ],
    prompt: generatePrompt(platformConfig),
    hooks: {
      onComplete: {
        action: 'verify_github_pr',
        // No config needed - verification reads from result.structured_output
        // and publishes CLUSTER_COMPLETE only if verification passes
      },
    },
    output: {
      topic: 'PR_CREATED',
      publishAfter: 'CLUSTER_COMPLETE',
    },
    structuredOutput: {
      type: 'object',
      properties: {
        pr_number: {
          type: 'number',
          description: 'MUST extract from gh pr create output - NOT from git push link',
        },
        pr_url: { type: 'string' },
        merged: { type: 'boolean' },
        merge_commit_sha: {
          type: 'string',
          description: 'MUST extract from gh pr merge output',
        },
      },
      required: ['pr_number', 'pr_url', 'merged', 'merge_commit_sha'],
    },
  };
}

/**
 * Get list of supported platforms for git-pusher
 * @returns {string[]} Array of platform IDs
 */
function getSupportedPlatforms() {
  return SUPPORTED_PLATFORMS;
}

/**
 * Check if a platform supports git-pusher (PR/MR creation)
 * @param {string} platform - Platform ID
 * @returns {boolean}
 */
function isPlatformSupported(platform) {
  return SUPPORTED_PLATFORMS.includes(platform);
}

module.exports = {
  generateGitPusherAgent,
  getSupportedPlatforms,
  isPlatformSupported,
  // Export for testing
  SHARED_TRIGGER_SCRIPT,
  SUPPORTED_PLATFORMS,
  resolveGitHubConfig,
  getPlatformConfig,
};
