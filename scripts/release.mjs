#!/usr/bin/env node
// Publishes a release of package.json's version, unless that version already has one.
//
//   npm run release            check, then tag v<version> and push it
//   npm run release -- --dry-run   only report what would happen
//
// Pushing the tag starts .github/workflows/release.yml, which builds macOS, Windows and Linux
// installers and publishes them to a GitHub Release (where Saturn's auto-update looks).
// Needs git, and the GitHub CLI (`gh`) signed in, to check existing releases.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = 'Saturn-Editor/Saturn';
const BRANCH = 'main';
const dryRun = process.argv.includes('--dry-run');

function run(command, args, { quiet = false } = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'] }).trim();
}

function succeeds(command, args) {
  try {
    run(command, args, { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function stop(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) stop(`package.json version "${version}" isn't a valid version`);
const tag = `v${version}`;

if (!succeeds('gh', ['auth', 'status'])) stop('The GitHub CLI isn\'t signed in. Run: gh auth login');

// Already released (or a release is being built from an existing tag): nothing to do.
if (succeeds('gh', ['release', 'view', tag, '--repo', REPO])) {
  console.log(`✔ ${tag} is already released. Bump the version in package.json to publish a new one.`);
  process.exit(0);
}
run('git', ['fetch', '--tags', '--quiet', 'origin']);
if (succeeds('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) {
  stop(`The tag ${tag} exists but has no release yet; its build may still be running (see the Actions tab), or it failed. Delete the tag to retry: git push origin :refs/tags/${tag} && git tag -d ${tag}`);
}

// Only release committed, pushed work from the main branch.
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== BRANCH) stop(`Releases are made from ${BRANCH}; this is ${branch}`);
if (run('git', ['status', '--porcelain'])) stop('There are uncommitted changes. Commit or stash them first');
run('git', ['fetch', '--quiet', 'origin', BRANCH]);
const local = run('git', ['rev-parse', 'HEAD']);
const remote = run('git', ['rev-parse', `origin/${BRANCH}`]);
if (local !== remote) stop(`${BRANCH} isn't in step with origin/${BRANCH}. Push or pull first`);

if (dryRun) {
  console.log(`Would tag ${local.slice(0, 7)} as ${tag} and push it, starting the release build.`);
  process.exit(0);
}

run('git', ['tag', '-a', tag, '-m', `Saturn ${version}`]);
run('git', ['push', 'origin', tag]);
console.log(`✔ Pushed ${tag}. The release builds in GitHub Actions: https://github.com/${REPO}/actions`);
console.log(`  It appears at https://github.com/${REPO}/releases/tag/${tag} when the builds finish.`);
