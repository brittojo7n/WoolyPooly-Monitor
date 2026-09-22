/*
 * bootstrap.js - COMPLETE. DO NOT MODIFY.
 *
 * Purpose: Fetch, hard-reset to origin/<current-branch> if behind, clean untracked,
 * then launch index.js. Local changes are discarded on execution.
 *
 * For development, run `node index.js` directly.
 */

const { execSync } = require('child_process');
const { join } = require('path');

const ROOT = __dirname;
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
const branch = `origin/${git('rev-parse --abbrev-ref HEAD')}`;

git('fetch origin');

try {
  git(`rev-parse --verify ${branch}`);
  const local = git('rev-parse HEAD');
  const remote = git(`rev-parse ${branch}`);
  if (local !== remote) {
    git(`reset --hard ${branch}`);
    git('clean -fd');
  }
} catch {
  throw new Error(`Upstream ${branch} not found`);
}

require(join(ROOT, 'index.js'));