import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import type { GitChange, GitCommit, GitStatus } from '@shared/types';

/** Generous, because push, pull and clone talk to a remote. */
const TIMEOUT_MS = 120_000;
const SEP = '\x1f';
const END = '\x1e';
/** Stash message prefix for changes shelved by a branch switch. */
const SHELF = 'saturn-shelf:';

function git(cwd: string | null, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', cwd ? ['-C', cwd, ...args] : args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      // Never hang waiting for a username or password nobody can type; the error says what failed instead.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error("Git isn't installed or isn't on PATH"));
      reject(new Error((stderr || error.message).trim().split('\n').filter(Boolean).slice(-3).join(' ')));
    });
  });
}

/** Parses `git status --porcelain=v1 -z`: "XY path" entries, with a second path after renames. */
function parseStatus(out: string): GitChange[] {
  const parts = out.split('\0');
  const changes: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const index = entry[0];
    const worktree = entry[1];
    const path = entry.slice(3);
    if (index === 'R' || index === 'C') i++; // the next part is the original path
    changes.push({ path, index, worktree });
  }
  return changes;
}

/**
 * The project's Git repository, through the system `git` command: status, staging, commits, history,
 * branches, push and pull. Every path is relative to the project folder.
 */
export class GitService {
  constructor(private readonly root: string) {}

  /** Clones `url` into a new folder inside `parentDir` (named after the repo) and returns its path. */
  static async clone(url: string, parentDir: string): Promise<string> {
    const name = basename(url.trim().replace(/\/+$/, '').replace(/\.git$/, '')) || 'repository';
    const target = join(parentDir, name);
    await git(null, ['clone', '--', url.trim(), target]);
    return target;
  }

  async status(): Promise<GitStatus> {
    const inside = await git(this.root, ['rev-parse', '--is-inside-work-tree']).then((o) => o.trim() === 'true', () => false);
    if (!inside) return { repo: false, branch: null, ahead: 0, behind: 0, upstream: null, changes: [] };
    const [branch, changes, counts] = await Promise.all([
      git(this.root, ['branch', '--show-current']).then((o) => o.trim() || null),
      git(this.root, ['status', '--porcelain=v1', '-z', '-uall']).then(parseStatus),
      git(this.root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).then((o) => o.trim().split(/\s+/).map(Number), () => null),
    ]);
    const upstream = counts ? await git(this.root, ['rev-parse', '--abbrev-ref', '@{upstream}']).then((o) => o.trim(), () => null) : null;
    return { repo: true, branch, behind: counts?.[0] ?? 0, ahead: counts?.[1] ?? 0, upstream, changes };
  }

  async init(): Promise<void> {
    await git(this.root, ['init']);
  }

  async stage(paths: string[]): Promise<void> {
    if (paths.length) await git(this.root, ['add', '--all', '--', ...paths]);
  }

  async unstage(paths: string[]): Promise<void> {
    if (!paths.length) return;
    // Before the first commit there's no HEAD to restore from, so unstaging means removing from the index.
    const hasHead = await git(this.root, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false);
    await git(this.root, hasHead ? ['restore', '--staged', '--', ...paths] : ['rm', '--cached', '-r', '--quiet', '--', ...paths]);
  }

  async commit(message: string): Promise<void> {
    if (!message.trim()) throw new Error('Enter a commit message');
    await git(this.root, ['commit', '-m', message]);
  }

  /** Recent commits on the current branch, newest first. */
  async log(limit = 200): Promise<GitCommit[]> {
    const format = ['%H', '%h', '%an', '%aI', '%s', '%D'].join('%x1f') + '%x1e';
    const out = await git(this.root, ['log', `-n${limit}`, `--format=${format}`]).catch((e: Error) => {
      // A new repository has no commits yet.
      if (/does not have any commits|bad default revision/.test(e.message)) return '';
      throw e;
    });
    return out.split(END).map((r) => r.trim()).filter(Boolean).map((r) => {
      const [hash, short, author, date, subject, refs] = r.split(SEP);
      return { hash, short, author, date, subject, refs: refs ? refs.split(', ').filter(Boolean) : [] };
    });
  }

  /** One commit's full message and changed files (status letter and path). */
  async show(hash: string): Promise<{ message: string; files: { status: string; path: string }[] }> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Not a commit hash');
    const message = (await git(this.root, ['show', '-s', '--format=%B', hash])).trim();
    const names = await git(this.root, ['show', '--name-status', '--format=', '-M', hash]);
    const files = names.split('\n').filter(Boolean).map((line) => {
      const [status, ...paths] = line.split('\t');
      return { status: status[0], path: paths[paths.length - 1] };
    });
    return { message, files };
  }

  async branches(): Promise<string[]> {
    const out = await git(this.root, ['branch', '--format=%(refname:short)']);
    return out.split('\n').map((b) => b.trim()).filter(Boolean);
  }

  /**
   * Switches branch, shelving pending changes first: they're stashed (untracked files included) under
   * a "saturn-shelf:<branch>" message for the branch being left, and a shelf saved earlier for the
   * target branch is restored. If the switch fails, the changes are put straight back.
   */
  async checkout(branch: string): Promise<void> {
    const { branch: from, changes } = await this.status();
    if (branch === from) return;
    let shelved = false;
    if (changes.length > 0) {
      await git(this.root, ['stash', 'push', '--include-untracked', '-m', `${SHELF}${from ?? 'HEAD'}`]);
      shelved = true;
    }
    try {
      await git(this.root, ['switch', branch]);
    } catch (e) {
      if (shelved) await git(this.root, ['stash', 'pop']).catch(() => undefined);
      throw e;
    }
    const shelf = await this.shelfFor(branch);
    if (shelf) {
      await git(this.root, ['stash', 'pop', shelf]).catch((e: Error) => {
        throw new Error(`Switched to ${branch}, but its shelved changes didn't apply cleanly (kept in the stash): ${e.message}`);
      });
    }
  }

  /** The stash ref (e.g. "stash@{1}") holding changes shelved when leaving `branch`, if any. */
  private async shelfFor(branch: string): Promise<string | null> {
    const out = await git(this.root, ['stash', 'list', `--format=%gd${SEP}%gs`]);
    for (const line of out.split('\n')) {
      const [ref, subject] = line.split(SEP);
      // Subjects read "On <branch>: <message>".
      if (ref && subject?.endsWith(`: ${SHELF}${branch}`)) return ref;
    }
    return null;
  }

  async createBranch(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a branch name');
    await git(this.root, ['check-ref-format', '--branch', trimmed]).catch(() => {
      throw new Error(`${trimmed} isn't a valid branch name`);
    });
    await git(this.root, ['switch', '-c', trimmed]);
  }

  /** Pushes the current branch, setting its upstream on origin the first time. */
  async push(): Promise<void> {
    const { branch, upstream } = await this.status();
    if (!branch) throw new Error('Check out a branch before pushing');
    await git(this.root, upstream ? ['push'] : ['push', '--set-upstream', 'origin', branch]);
  }

  async pull(): Promise<void> {
    await git(this.root, ['pull', '--ff-only']);
  }
}
