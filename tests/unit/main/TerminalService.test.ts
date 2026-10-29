import { describe, expect, it } from 'vitest';
import { TerminalService, type Pty } from '../../../src/main/Services/TerminalService';

function fakePty(process: string): Pty & { process: string } {
  return { process, onData: () => undefined, onExit: () => undefined, write: () => undefined, resize: () => undefined, kill: () => undefined };
}

describe('busy terminals', () => {
  it('reports programs other than the shell, per window', () => {
    const ptys = [fakePty('zsh'), fakePty('claude'), fakePty('node')];
    let next = 0;
    const terminals = new TerminalService(() => ptys[next++], 'darwin', { SHELL: '/bin/zsh' });
    terminals.create({ cwd: '/', name: 'a' }, 1);
    terminals.create({ cwd: '/', name: 'b' }, 1);
    terminals.create({ cwd: '/', name: 'c' }, 2);
    expect(terminals.runningFor(1)).toEqual(['claude']);
    expect(terminals.runningFor(2)).toEqual(['node']);
    expect(terminals.runningFor(3)).toEqual([]);
  });

  it('treats a login shell ("-zsh") as idle', () => {
    const terminals = new TerminalService(() => fakePty('-zsh'), 'darwin', { SHELL: '/bin/zsh' });
    terminals.create({ cwd: '/', name: 'a' }, 1);
    expect(terminals.runningFor(1)).toEqual([]);
  });
});
