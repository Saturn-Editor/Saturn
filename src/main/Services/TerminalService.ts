import { randomUUID } from 'node:crypto';

export interface Pty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  readonly process?: string;
}

export type PtyFactory = (
  shell: string,
  args: string[],
  opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
) => Pty;

interface Session {
  pty: Pty;
  owner: number;
  shell: string;
}

function programName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.exe$/i, '').replace(/^-/, '').toLowerCase();
}

type DataListener = (owner: number, id: string, data: string) => void;
type ExitListener = (owner: number, id: string, code: number) => void;

/** Runs pseudo-terminals for editor windows. Events go only to the window that owns the terminal. */
export class TerminalService {
  private readonly sessions = new Map<string, Session>();
  private readonly dataListeners: DataListener[] = [];
  private readonly exitListeners: ExitListener[] = [];

  constructor(
    private readonly factory: PtyFactory,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  create(opts: { cwd: string; name: string; command?: string }, owner: number): string {
    const args = this.platform === 'win32' ? [] : ['-l'];
    const shell = this.defaultShell();
    const pty = this.factory(shell, args, { cwd: opts.cwd, cols: 80, rows: 24, env: { ...this.env, TERM: 'xterm-256color' } });
    // Commands are typed into an interactive shell rather than run with `-c`: very short commands
    // can exit before their output is read, and the user can keep using the terminal afterwards.
    if (opts.command) pty.write(`${opts.command}\r`);
    const id = randomUUID();
    this.sessions.set(id, { pty, owner, shell });
    pty.onData((data) => this.dataListeners.forEach((l) => l(owner, id, data)));
    pty.onExit((code) => {
      this.sessions.delete(id);
      this.exitListeners.forEach((l) => l(owner, id, code));
    });
    return id;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.sessions.get(id)?.pty.resize(cols, rows);
  }

  kill(id: string): void {
    this.sessions.get(id)?.pty.kill();
    this.sessions.delete(id);
  }

  runningFor(owner: number): string[] {
    const running: string[] = [];
    for (const s of this.sessions.values()) {
      const current = s.pty.process ? programName(s.pty.process) : '';
      if (s.owner === owner && current && current !== programName(s.shell)) running.push(current);
    }
    return running;
  }

  killAllFor(owner: number): void {
    for (const [id, s] of this.sessions) if (s.owner === owner) this.kill(id);
  }

  onData(listener: DataListener): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: ExitListener): void {
    this.exitListeners.push(listener);
  }

  private defaultShell(): string {
    if (this.platform === 'win32') return this.env.COMSPEC ?? 'powershell.exe';
    return this.env.SHELL ?? '/bin/bash';
  }
}
