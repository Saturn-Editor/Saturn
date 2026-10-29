import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { GitService } from '../../../src/main/Services/GitService';

let root: string;
let git: GitService;

const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

function commit(file: string, text: string, message: string): string {
  writeFileSync(join(root, file), text);
  run('add', '--', file);
  run('commit', '-q', '-m', message);
  return run('rev-parse', 'HEAD').trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'saturn-git-'));
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Tester');
  run('config', 'commit.gpgsign', 'false');
  git = new GitService(root);
});

describe('GitService', () => {
  it('lists the history of one file only', async () => {
    commit('a.txt', 'one\n', 'Add a');
    commit('b.txt', 'b\n', 'Add b');
    commit('a.txt', 'two\n', 'Change a');
    expect((await git.log(200, undefined, 'a.txt')).map((c) => c.subject)).toEqual(['Change a', 'Add a']);
  });

  it('blames each line with its author and commit', async () => {
    const first = commit('a.txt', 'one\n', 'First');
    const second = commit('a.txt', 'one\ntwo\n', 'Second');
    const lines = await git.blame('a.txt');
    expect(lines.map((l) => [l.hash, l.summary, l.author])).toEqual([[first, 'First', 'Tester'], [second, 'Second', 'Tester']]);
  });

  it('lists the commits after a base, oldest first', async () => {
    const base = commit('a.txt', '0\n', 'Base');
    commit('a.txt', '1\n', 'One');
    commit('a.txt', '2\n', 'Two');
    expect((await git.rebaseCommits(base)).map((c) => c.subject)).toEqual(['One', 'Two']);
  });

  it('rebases interactively: reorders and drops', async () => {
    const base = commit('a.txt', 'a\n', 'Base');
    const one = commit('one.txt', '1\n', 'One');
    const two = commit('two.txt', '2\n', 'Two');
    const three = commit('three.txt', '3\n', 'Three');
    await git.rebaseInteractive(base, [
      { hash: three, action: 'pick' },
      { hash: one, action: 'pick' },
      { hash: two, action: 'drop' },
    ]);
    expect((await git.log(10)).map((c) => c.subject)).toEqual(['One', 'Three', 'Base']);
  });

  it('squashes into the previous commit', async () => {
    const base = commit('a.txt', 'a\n', 'Base');
    const one = commit('one.txt', '1\n', 'One');
    const two = commit('two.txt', '2\n', 'Two');
    await git.rebaseInteractive(base, [{ hash: one, action: 'pick' }, { hash: two, action: 'fixup' }]);
    expect((await git.log(10)).map((c) => c.subject)).toEqual(['One', 'Base']);
  });

  it('refuses a plan that starts with squash', async () => {
    const base = commit('a.txt', 'a\n', 'Base');
    const one = commit('one.txt', '1\n', 'One');
    await expect(git.rebaseInteractive(base, [{ hash: one, action: 'squash' }])).rejects.toThrow('picked or edited');
  });

  it('gives both sides of a merge conflict', async () => {
    commit('a.txt', 'base\n', 'Base');
    run('checkout', '-q', '-b', 'other');
    commit('a.txt', 'theirs\n', 'Theirs');
    run('checkout', '-q', 'main');
    commit('a.txt', 'ours\n', 'Ours');
    await expect(git.merge('other')).rejects.toThrow(/conflicts/);
    const versions = await git.conflictVersions('a.txt');
    expect(versions).toEqual({ base: 'base\n', ours: 'ours\n', theirs: 'theirs\n' });
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toContain('<<<<<<<');
  });
});
