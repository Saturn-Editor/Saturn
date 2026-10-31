import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { BlameLine, ConflictVersions, GitChange, GitCommit, GitOperation, GitRemote, GitStash, GitStatus, GitTag, RebaseStep, WorkingDiff } from '@shared/types';

/** Generous, because push, pull and clone talk to a remote. */
const TIMEOUT_MS = 120_000;
const SEP = '\x1f';
const END = '\x1e';
/** Stash message prefix for changes shelved by a branch switch. */
const SHELF = 'saturn-shelf:';

/**
 * How Git asks for a username or password: GIT_ASKPASS points at Saturn's helper, which asks the user
 * in a Saturn window (see AskpassService). Without it, Git never prompts and the error says what failed.
 */
let askpassEnv: (projectPath: string | null) => Record<string, string> = () => ({});

export function setAskpass(env: (projectPath: string | null) => Record<string, string>): void {
  askpassEnv = env;
}

/** `git diff --exit-code`-style commands exit 1 when there are differences; those count as success. */
function git(cwd: string | null, args: string[], okCodes: number[] = [], extraEnv: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', cwd ? ['-C', cwd, ...args] : args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      // Never prompt in a terminal nobody can see; credentials come through the askpass helper instead.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...askpassEnv(cwd), ...extraEnv },
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      if (!error || okCodes.includes(Number(error.code))) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error("Git isn't installed or isn't on PATH"));
      reject(new Error((stderr.trim() || stdout.trim() || error.message).trim().split('\n').filter(Boolean).slice(-3).join(' ')));
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

const OPERATION_NAMES: Record<GitOperation, string> = { merge: 'Merging', rebase: 'Rebasing onto', 'cherry-pick': 'Cherry-picking', revert: 'Reverting' };

/** What to tell the user when an operation stops on conflicts; other failures keep Git's message. */
function stoppedMessage(op: GitOperation, gitMessage: string, what?: string): string {
  if (!/CONFLICT|could not apply|Automatic merge failed|after resolving the conflicts/i.test(gitMessage)) return gitMessage;
  return `${OPERATION_NAMES[op]}${what ? ` ${what}` : ''} stopped on conflicts. Fix the files marked in the Commit panel, then Continue (or Abort)`;
}

/**
 * The project's Git repository, through the system `git` command: status, staging, commits, history,
 * diffs (and staging single hunks), branches (switch, create, merge, rebase, delete), cherry-pick,
 * revert, tags, stashes, remotes, conflict resolution, push and pull. Every path is relative to the project folder.
 */
export class GitService {
  constructor(readonly root: string) {}

  /** Clones `url` into a new folder inside `parentDir` (named after the repo) and returns its path. */
  static async clone(url: string, parentDir: string): Promise<string> {
    const name = basename(url.trim().replace(/\/+$/, '').replace(/\.git$/, '')) || 'repository';
    const target = join(parentDir, name);
    await git(null, ['clone', '--', url.trim(), target]);
    return target;
  }

  async status(): Promise<GitStatus> {
    const inside = await git(this.root, ['rev-parse', '--is-inside-work-tree']).then((o) => o.trim() === 'true', () => false);
    if (!inside) return { repo: false, branch: null, ahead: 0, behind: 0, upstream: null, changes: [], operation: null, conflicts: [] };
    const [branch, changes, counts] = await Promise.all([
      git(this.root, ['branch', '--show-current']).then((o) => o.trim() || null),
      this.unstageReverted().then(() => git(this.root, ['status', '--porcelain=v1', '-z', '-uall'])).then(parseStatus),
      git(this.root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).then((o) => o.trim().split(/\s+/).map(Number), () => null),
    ]);
    const upstream = counts ? await git(this.root, ['rev-parse', '--abbrev-ref', '@{upstream}']).then((o) => o.trim(), () => null) : null;
    // Both sides changed, or one deleted what the other changed: "UU", "AA", "DD", "AU", "UA", "DU", "UD".
    const conflicts = changes.filter((c) => c.index === 'U' || c.worktree === 'U' || (c.index === c.worktree && 'AD'.includes(c.index))).map((c) => c.path);
    return { repo: true, branch, behind: counts?.[0] ?? 0, ahead: counts?.[1] ?? 0, upstream, changes, operation: await this.operation(), conflicts };
  }

  private async unstageReverted(): Promise<void> {
    const both = parseStatus(await git(this.root, ['status', '--porcelain=v1', '-z', '-uno']))
      .filter((c) => c.index === 'M' && c.worktree === 'M')
      .map((c) => c.path);
    if (!both.length) return;
    const differing = new Set((await git(this.root, ['diff', '--name-only', '-z', 'HEAD', '--', ...both])).split('\0').filter(Boolean));
    const reverted = both.filter((p) => !differing.has(p));
    if (reverted.length) await git(this.root, ['reset', '-q', '--', ...reverted]);
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

  /** Recent commits on the current branch (or `ref`, e.g. another branch or a tag), newest first. */
  async log(limit = 200, ref?: string, path?: string): Promise<GitCommit[]> {
    if (ref && (ref.startsWith('-') || /\s/.test(ref))) throw new Error('Not a branch or tag');
    const format = ['%H', '%h', '%an', '%aI', '%s', '%D'].join('%x1f') + '%x1e';
    const args = ['log', `-n${limit}`, `--format=${format}`, ...(path ? ['--follow'] : []), ...(ref ? [ref] : []), '--', ...(path ? [path] : [])];
    const out = await git(this.root, args).catch((e: Error) => {
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

  /** Remote-tracking branches, e.g. "origin/main" (not the remotes' HEAD pointers). */
  async remoteBranches(): Promise<string[]> {
    const out = await git(this.root, ['branch', '-r', '--format=%(refname:short)']);
    return out.split('\n').map((b) => b.trim()).filter((b) => b && !b.endsWith('/HEAD') && b.includes('/'));
  }

  async renameBranch(from: string, to: string): Promise<void> {
    const trimmed = to.trim();
    await git(this.root, ['check-ref-format', '--branch', trimmed]).catch(() => {
      throw new Error(trimmed ? `${trimmed} isn't a valid branch name` : 'Enter a branch name');
    });
    await git(this.root, ['branch', '-m', '--', from, trimmed]);
  }

  /**
   * Switches branch. With "bring", pending changes come along (Git refuses if they'd clash with the
   * target branch, and nothing changes). With "shelve", they're stashed (untracked files included) under
   * a "saturn-shelf:<branch>" message for the branch being left, and a shelf saved earlier for the
   * target branch is restored; if the switch fails, the changes are put straight back.
   */
  async checkout(branch: string, mode: 'bring' | 'shelve' = 'shelve'): Promise<void> {
    const { branch: from, changes } = await this.status();
    if (branch === from) return;
    if (mode === 'bring') {
      await git(this.root, ['switch', branch]).catch((e: Error) => {
        throw new Error(/would be overwritten|commit your changes or stash/i.test(e.message)
          ? `Your changes clash with ${branch}, so they can't come along. Commit them, or switch and shelve them instead`
          : e.message);
      });
      return;
    }
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

  /** Pushes the current branch, setting its upstream the first time (on origin, or the only remote). */
  async push(): Promise<void> {
    const { branch, upstream } = await this.status();
    if (!branch) throw new Error('Check out a branch before pushing');
    if (upstream) {
      await git(this.root, ['push']);
      return;
    }
    const remotes = await this.remotes();
    const remote = remotes.length === 1 ? remotes[0].name : remotes.some((r) => r.name === 'origin') ? 'origin' : null;
    if (!remote) throw new Error(remotes.length ? 'Choose which remote to push to' : 'Add a remote to push to');
    await git(this.root, ['push', '--set-upstream', '--', remote, branch]);
  }

  async pull(): Promise<void> {
    await git(this.root, ['pull', '--ff-only']);
  }

  /**
   * Deletes a local branch; `force` also deletes one whose commits aren't merged anywhere. Deleting the
   * current branch first switches to main (or master, or another branch), bringing pending changes along.
   */
  async deleteBranch(name: string, force = false): Promise<void> {
    const { branch } = await this.status();
    if (name === branch) {
      const others = (await this.branches()).filter((b) => b !== name);
      const fallback = others.find((b) => b === 'main') ?? others.find((b) => b === 'master') ?? others[0];
      if (!fallback) throw new Error(`${name} is the only branch, so it can't be deleted`);
      // Unmerged work would be lost once we've switched away, so check before moving.
      if (!force) {
        const unmerged = await git(this.root, ['rev-list', '--count', `${fallback}..${name}`]).then((o) => Number(o.trim()) > 0, () => false);
        if (unmerged) throw new Error(`${name} has commits that aren't merged anywhere`);
      }
      // A plain switch carries uncommitted changes over (unlike checkout's shelving).
      await git(this.root, ['switch', fallback]);
      await git(this.root, ['branch', '-D', '--', name]);
      return;
    }
    await git(this.root, ['branch', force ? '-D' : '-d', '--', name]).catch((e: Error) => {
      throw new Error(/not fully merged/.test(e.message) ? `${name} has commits that aren't merged anywhere` : e.message);
    });
  }

  /** Merges a branch into the current one. Conflicts are left in the files to resolve, then commit. */
  async merge(name: string): Promise<void> {
    await git(this.root, ['merge', '--no-edit', name]).catch((e: Error) => {
      throw new Error(/CONFLICT|Automatic merge failed/.test(e.message)
        ? stoppedMessage('merge', e.message, name)
        : e.message);
    });
  }

  /** The merge, rebase, cherry-pick or revert waiting to be continued or aborted, if any. */
  async operation(): Promise<GitOperation | null> {
    const dir = (await git(this.root, ['rev-parse', '--absolute-git-dir']).catch(() => '')).trim();
    if (!dir) return null;
    if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) return 'rebase';
    if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
    if (existsSync(join(dir, 'REVERT_HEAD'))) return 'revert';
    if (existsSync(join(dir, 'MERGE_HEAD'))) return 'merge';
    return null;
  }

  /** Abandons the stopped merge, rebase, cherry-pick or revert, putting things back as they were. */
  async abortOperation(): Promise<void> {
    const op = await this.operation();
    if (op) await git(this.root, [op, '--abort']);
  }

  /**
   * Carries on with the stopped operation once conflicts are fixed (and staged): commits a merge, or
   * continues a rebase, cherry-pick or revert. Git's default messages are kept, without opening an editor.
   */
  async continueOperation(): Promise<void> {
    const op = await this.operation();
    if (!op) return;
    const { conflicts } = await this.status();
    if (conflicts.length) throw new Error(`Resolve the conflicts in ${conflicts.length} file${conflicts.length === 1 ? '' : 's'} first`);
    await git(this.root, op === 'merge' ? ['-c', 'core.editor=true', 'commit', '--no-edit'] : ['-c', 'core.editor=true', op, '--continue']).catch((e: Error) => {
      throw new Error(stoppedMessage(op, e.message));
    });
  }

  /** Replays the current branch's own commits on top of another branch. */
  async rebase(onto: string): Promise<void> {
    await git(this.root, ['rebase', '--', onto]).catch((e: Error) => {
      throw new Error(stoppedMessage('rebase', e.message, onto));
    });
  }

  /** Applies one commit's changes on top of the current branch as a new commit. */
  async cherryPick(hash: string): Promise<void> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Not a commit hash');
    await git(this.root, ['cherry-pick', hash]).catch((e: Error) => {
      throw new Error(stoppedMessage('cherry-pick', e.message, hash.slice(0, 7)));
    });
  }

  /** Makes a new commit that undoes one commit. */
  async revert(hash: string): Promise<void> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Not a commit hash');
    await git(this.root, ['revert', '--no-edit', hash]).catch((e: Error) => {
      throw new Error(stoppedMessage('revert', e.message, hash.slice(0, 7)));
    });
  }

  async tags(): Promise<GitTag[]> {
    const out = await git(this.root, ['tag', '--sort=-creatordate', `--format=%(refname:short)${SEP}%(objectname:short)${SEP}%(*objectname:short)${SEP}%(contents:subject)`]);
    return out.split('\n').filter(Boolean).map((line) => {
      const [name, object, target, message] = line.split(SEP);
      // Annotated tags point at a tag object, whose target is the commit.
      return { name, commit: target || object, message: target ? message : '' };
    });
  }

  /** Tags a commit (HEAD when not given); a message makes it an annotated tag. */
  async createTag(name: string, hash?: string, message = ''): Promise<void> {
    const trimmed = name.trim();
    await git(this.root, ['check-ref-format', `refs/tags/${trimmed}`]).catch(() => {
      throw new Error(trimmed ? `${trimmed} isn't a valid tag name` : 'Enter a tag name');
    });
    if (hash && !/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Not a commit hash');
    await git(this.root, ['tag', ...(message.trim() ? ['-a', '-m', message.trim()] : []), '--', trimmed, ...(hash ? [hash] : [])]);
  }

  /**
   * Git can't rename a tag, so this tags the same commit with the new name (keeping an annotated tag's
   * message) and deletes the old one. Tags already pushed keep their old name on the remote.
   */
  async renameTag(from: string, to: string): Promise<void> {
    const tag = (await this.tags()).find((t) => t.name === from);
    if (!tag) throw new Error(`There's no tag ${from}`);
    const full = (await git(this.root, ['rev-parse', `refs/tags/${from}^{commit}`])).trim();
    const message = tag.message ? (await git(this.root, ['tag', '-l', '--format=%(contents)', '--', from])).trim() : '';
    await this.createTag(to, full, message);
    await this.deleteTag(from);
  }

  async deleteTag(name: string): Promise<void> {
    await git(this.root, ['tag', '-d', '--', name]);
  }

  /** Pushes every tag to a remote (origin, or the only one). */
  async pushTags(): Promise<void> {
    const remotes = await this.remotes();
    const remote = remotes.some((r) => r.name === 'origin') ? 'origin' : remotes.length === 1 ? remotes[0].name : null;
    if (!remote) throw new Error(remotes.length ? 'Several remotes and no origin: push tags from a terminal' : 'Add a remote to push to');
    await git(this.root, ['push', '--tags', '--', remote]);
  }

  /** A file's uncommitted changes, split into staged and unstaged diffs (for staging single hunks). */
  async workingDiff(path: string): Promise<WorkingDiff> {
    const tracked = await git(this.root, ['ls-files', '--error-unmatch', '--', path]).then(() => true, () => false);
    if (!tracked) return { staged: '', unstaged: await this.diff(path), untracked: true };
    const [staged, unstaged] = await Promise.all([
      git(this.root, ['diff', '--cached', '--', path]),
      git(this.root, ['diff', '--', path]),
    ]);
    return { staged, unstaged, untracked: false };
  }

  /** Stages (or with `unstage`, unstages) one hunk, given as a patch: a file header plus that hunk. */
  async applyHunk(patch: string, unstage: boolean): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'saturn-hunk-'));
    const file = join(dir, 'hunk.patch');
    try {
      await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`);
      await git(this.root, ['apply', '--cached', '--unidiff-zero', ...(unstage ? ['-R'] : []), '--', file]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Settles a conflicted file by taking one side ("ours" is the current branch), then stages it. */
  async resolveWith(path: string, side: 'ours' | 'theirs'): Promise<void> {
    await git(this.root, ['checkout', `--${side}`, '--', path]);
    await git(this.root, ['add', '--', path]);
  }

  /** Saved stashes, newest first; ones a branch switch shelved say which branch. */
  async stashes(): Promise<GitStash[]> {
    const out = await git(this.root, ['stash', 'list', `--format=%gd${SEP}%gs${SEP}%cI`]);
    return out.split('\n').filter(Boolean).map((line) => {
      const [ref, subject, date] = line.split(SEP);
      // Subjects read "On <branch>: <message>" or "WIP on <branch>: <commit>".
      const match = /^(?:WIP )?[Oo]n ([^:]+): (.*)$/.exec(subject ?? '');
      const message = match?.[2] ?? subject ?? '';
      const shelf = message.startsWith(SHELF) ? message.slice(SHELF.length) : null;
      return { ref, branch: match?.[1] ?? null, message: shelf ? `Shelved when leaving ${shelf}` : message, date, shelf };
    });
  }

  /** Stashes every change, untracked files included. */
  async stash(message: string): Promise<void> {
    const { changes } = await this.status();
    if (!changes.length) throw new Error('There are no changes to stash');
    await git(this.root, ['stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message.trim()] : [])]);
  }

  /** Applies a stash; `pop` also removes it once applied. */
  async applyStash(ref: string, pop: boolean): Promise<void> {
    if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('Not a stash');
    await git(this.root, ['stash', pop ? 'pop' : 'apply', ref]);
  }

  async dropStash(ref: string): Promise<void> {
    if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('Not a stash');
    await git(this.root, ['stash', 'drop', ref]);
  }

  async remotes(): Promise<GitRemote[]> {
    const out = await git(this.root, ['remote', '-v']);
    const remotes = new Map<string, string>();
    for (const line of out.split('\n')) {
      const [name, url] = line.split(/\s+/);
      if (name && url && !remotes.has(name)) remotes.set(name, url);
    }
    return [...remotes].map(([name, url]) => ({ name, url }));
  }

  async addRemote(name: string, url: string): Promise<void> {
    if (!/^[\w.-]+$/.test(name.trim())) throw new Error('Enter a remote name (letters, numbers, . _ -)');
    if (!url.trim()) throw new Error('Enter the remote URL');
    await git(this.root, ['remote', 'add', '--', name.trim(), url.trim()]);
  }

  async removeRemote(name: string): Promise<void> {
    await git(this.root, ['remote', 'remove', '--', name]);
  }

  /** Pushes to a chosen remote, making it the branch's upstream. */
  async pushTo(remote: string): Promise<void> {
    const { branch } = await this.status();
    if (!branch) throw new Error('Check out a branch before pushing');
    await git(this.root, ['push', '--set-upstream', '--', remote, branch]);
  }

  /**
   * A file's uncommitted changes as a unified diff (against the last commit; new files against
   * nothing), or a file's changes in one commit when `hash` is given.
   */
  async diff(path: string, hash?: string): Promise<string> {
    if (hash) {
      if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Not a commit hash');
      return git(this.root, ['show', '--format=', '-M', hash, '--', path]);
    }
    const tracked = await git(this.root, ['ls-files', '--error-unmatch', '--', path]).then(() => true, () => false);
    if (!tracked) return git(this.root, ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', path], [1]);
    const hasHead = await git(this.root, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false);
    return git(this.root, hasHead ? ['diff', 'HEAD', '--', path] : ['diff', '--cached', '--', path]);
  }

  async blame(path: string): Promise<BlameLine[]> {
    const out = await git(this.root, ['blame', '--porcelain', '--', path]);
    const commits = new Map<string, Omit<BlameLine, 'hash'>>();
    const lines: BlameLine[] = [];
    let hash = '';
    for (const line of out.split('\n')) {
      const header = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
      if (header) {
        hash = header[1];
        if (!commits.has(hash)) commits.set(hash, { author: '', time: 0, summary: '' });
      } else if (line.startsWith('author ')) commits.get(hash)!.author = line.slice(7);
      else if (line.startsWith('author-time ')) commits.get(hash)!.time = Number(line.slice(12)) * 1000;
      else if (line.startsWith('summary ')) commits.get(hash)!.summary = line.slice(8);
      else if (line.startsWith('\t')) lines.push({ hash, ...commits.get(hash)! });
    }
    return lines.map((l) => (/^0+$/.test(l.hash) ? { ...l, author: 'You', summary: 'Not committed yet' } : l));
  }

  async rebaseCommits(onto: string): Promise<GitCommit[]> {
    if (!/^[0-9a-f]{4,40}$/i.test(onto)) throw new Error('Not a commit hash');
    return (await this.log(500, `${onto}..HEAD`)).reverse();
  }

  async rebaseInteractive(onto: string, steps: RebaseStep[]): Promise<void> {
    if (!/^[0-9a-f]{4,40}$/i.test(onto)) throw new Error('Not a commit hash');
    if (steps.some((s) => !/^[0-9a-f]{4,40}$/i.test(s.hash) || !['pick', 'squash', 'fixup', 'edit', 'drop'].includes(s.action))) throw new Error('Invalid rebase plan');
    if (['squash', 'fixup'].includes(steps.find((s) => s.action !== 'drop')?.action ?? '')) throw new Error('The first commit kept must be picked or edited');
    const dir = await mkdtemp(join(tmpdir(), 'saturn-rebase-'));
    const todo = join(dir, 'todo');
    try {
      await writeFile(todo, steps.map((s) => `${s.action} ${s.hash}`).join('\n') + '\n');
      const editor = `cp '${todo.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
      await git(this.root, ['-c', 'core.editor=true', 'rebase', '-i', onto], [], { GIT_SEQUENCE_EDITOR: editor }).catch((e: Error) => {
        if (/Stopped at|You can amend the commit now/i.test(e.message)) return '';
        throw new Error(stoppedMessage('rebase', e.message));
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async conflictVersions(path: string): Promise<ConflictVersions> {
    const stage = (n: number) => git(this.root, ['show', `:${n}:${path}`]).catch(() => '');
    const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)]);
    return { base, ours, theirs };
  }
}
