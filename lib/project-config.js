/**
 * Per-project config stored in ~/.zeroshot/projects/.
 *
 * Each project gets a JSON file keyed by SHA-256 hash (first 12 chars)
 * of its absolute path. This avoids writing any files into user projects.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ZEROSHOT_PROJECTS_DIR =
  process.env.ZEROSHOT_PROJECTS_DIR || path.join(os.homedir(), '.zeroshot', 'projects');

/**
 * SHA-256 hash (first 12 hex chars) of the absolute project path.
 * @param {string} projectPath - Absolute path to project root
 * @returns {string}
 */
function getProjectHash(projectPath) {
  const absolute = path.resolve(projectPath);
  return crypto.createHash('sha256').update(absolute).digest('hex').slice(0, 12);
}

/**
 * Full path to the project config file.
 * @param {string} projectPath - Absolute path to project root
 * @returns {string}
 */
function getProjectConfigPath(projectPath) {
  return path.join(ZEROSHOT_PROJECTS_DIR, `${getProjectHash(projectPath)}.json`);
}

/**
 * Load project config from disk.
 * @param {string} projectPath - Absolute path to project root
 * @returns {object|null} Parsed config or null if missing
 */
function loadProjectConfig(projectPath) {
  const configPath = getProjectConfigPath(projectPath);
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Save project config to disk (creates directory if needed).
 * @param {string} projectPath - Absolute path to project root
 * @param {object} config - Config object to persist
 */
function saveProjectConfig(projectPath, config) {
  const configPath = getProjectConfigPath(projectPath);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = { projectPath: path.resolve(projectPath), ...config };
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  ZEROSHOT_PROJECTS_DIR,
  getProjectHash,
  getProjectConfigPath,
  loadProjectConfig,
  saveProjectConfig,
};
