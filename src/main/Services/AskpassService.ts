import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The helper Git runs as GIT_ASKPASS (and SSH as SSH_ASKPASS): it sends the prompt to Saturn over a
 * local socket and prints the answer, or exits 1 if the user cancelled. Runs on Saturn's own runtime.
 */
const HELPER_JS = `const net = require('node:net');
const socket = net.connect(process.env.SATURN_ASKPASS_SOCKET);
let reply = '';
socket.on('connect', () => socket.end(JSON.stringify({
  token: process.env.SATURN_ASKPASS_TOKEN,
  project: process.env.SATURN_ASKPASS_PROJECT || null,
  prompt: process.argv[2] || 'Password:',
})));
socket.on('data', (d) => { reply += d; });
socket.on('end', () => {
  const { answer } = JSON.parse(reply || '{}');
  if (typeof answer !== 'string') process.exit(1);
  process.stdout.write(answer + '\\n');
});
socket.on('error', () => process.exit(1));
`;

export interface AskpassEvents {
  /** Show a prompt in the project's window (or the focused window when null); answer with `answer`. */
  prompt(projectPath: string | null, id: string, prompt: string, secret: boolean): void;
}

/** Lets Git ask the user for usernames, passwords, tokens and SSH passphrases in a Saturn window. */
export class AskpassService {
  private server: Server | null = null;
  private readonly token = randomBytes(24).toString('hex');
  private readonly socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\saturn-askpass-${process.pid}`
    : join(tmpdir(), `saturn-askpass-${process.pid}.sock`);
  private readonly pending = new Map<string, (answer: string | null) => void>();
  private script = '';
  private helper = '';

  constructor(private readonly dir: string, private readonly events: AskpassEvents) {}

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.helper = join(this.dir, 'askpass.cjs');
    await writeFile(this.helper, HELPER_JS);
    if (process.platform === 'win32') {
      this.script = join(this.dir, 'askpass.cmd');
      await writeFile(this.script, '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%SATURN_ASKPASS_NODE%" "%SATURN_ASKPASS_JS%" %*\r\n');
    } else {
      this.script = join(this.dir, 'askpass.sh');
      await writeFile(this.script, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$SATURN_ASKPASS_NODE" "$SATURN_ASKPASS_JS" "$@"\n');
      await chmod(this.script, 0o755);
    }
    this.server = createServer((socket) => {
      let data = '';
      socket.on('data', (d) => (data += d));
      socket.on('end', () => {
        let request: { token?: string; project?: string | null; prompt?: string } = {};
        try {
          request = JSON.parse(data);
        } catch {
          // Not from the helper.
        }
        if (request.token !== this.token) return socket.destroy();
        const prompt = String(request.prompt ?? 'Password:').trim();
        const id = randomUUID();
        this.pending.set(id, (answer) => socket.end(JSON.stringify({ answer })));
        socket.on('close', () => this.pending.delete(id));
        // Usernames are shown as typed; passwords, tokens and passphrases are hidden.
        this.events.prompt(request.project ?? null, id, prompt, !/username/i.test(prompt));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(this.socketPath, resolve));
  }

  /** Environment for a Git command run in a project (null for a clone). */
  env(projectPath: string | null): Record<string, string> {
    if (!this.script) return {};
    return {
      GIT_ASKPASS: this.script,
      SSH_ASKPASS: this.script,
      SSH_ASKPASS_REQUIRE: 'force',
      SATURN_ASKPASS_NODE: process.execPath,
      SATURN_ASKPASS_JS: this.helper,
      SATURN_ASKPASS_SOCKET: this.socketPath,
      SATURN_ASKPASS_TOKEN: this.token,
      SATURN_ASKPASS_PROJECT: projectPath ?? '',
    };
  }

  answer(id: string, answer: string | null): void {
    this.pending.get(id)?.(answer);
    this.pending.delete(id);
  }

  stop(): void {
    for (const reply of this.pending.values()) reply(null);
    this.pending.clear();
    this.server?.close();
  }
}
