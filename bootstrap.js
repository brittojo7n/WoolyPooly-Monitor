/**
 * bootstrap.js - Application bootstrap script
 *
 * Purpose: Fetch, hard-reset to origin/main if behind, clean untracked files,
 * then launch index.js. Local changes are discarded on execution.
 *
 * For development, run `node index.js` directly.
 */

const { execSync } = require('child_process');
const { join } = require('path');

const ROOT = __dirname;
const BRANCH = 'main';
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();

function syncWithUpstream() {
  git('fetch origin --prune');

  try {
    git(`checkout ${BRANCH}`);
    git(`rev-parse --verify origin/${BRANCH}`);

    const localHead = git('rev-parse HEAD');
    const remoteHead = git(`rev-parse origin/${BRANCH}`);

    if (localHead !== remoteHead) {
      git(`reset --hard origin/${BRANCH}`);
      git('clean -fd');
    }

    git(`pull origin ${BRANCH}`);
  } catch (err) {
    console.error(`Failed to sync with upstream: ${err.message}`);
  }
}

function main() {
  syncWithUpstream();
  require(join(ROOT, 'index.js'));
}

main();