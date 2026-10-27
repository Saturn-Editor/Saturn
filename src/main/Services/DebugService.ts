import type { ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import type { MessageKind } from '@shared/modules';
import type { DebugFrame, DebugScope, DebugState, DebugVariable } from '@shared/types';
import type { BreakpointStore } from '../Store/BreakpointStore';
import type { InstalledLanguage } from './CodeModuleService';
import { fillSettings, spawnModuleProcess } from './LanguageServerService';

const STOP_TIMEOUT_MS = 2000;
const MAX_FRAMES = 50;

interface DapMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  arguments?: unknown;
  body?: any;
}

/** Debug Adapter Protocol over a child process's stdio: Content-Length framed JSON. */
class DapConnection {
  private seq = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, { resolve: (body: any) => void; reject: (e: Error) => void }>();

  constructor(private readonly child: ChildProcess, private readonly onEvent: (event: string, body: any) => void) {
    child.stdout!.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    child.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('The debugger stopped'));
      this.pending.clear();
    });
  }

  request<T = any>(command: string, args?: unknown): Promise<T> {
    const seq = this.seq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.send({ seq, type: 'request', command, arguments: args });
    });
  }

  private send(message: DapMessage): void {
    const json = Buffer.from(JSON.stringify(message), 'utf8');
    this.child.stdin!.write(`Content-Length: ${json.length}\r\n\r\n`);
    this.child.stdin!.write(json);
  }

  private drain(): void {
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const length = Number(/Content-Length: *(\d+)/i.exec(this.buffer.subarray(0, end).toString('ascii'))?.[1]);
      if (!Number.isFinite(length) || this.buffer.length < end + 4 + length) return;
      const body = this.buffer.subarray(end + 4, end + 4 + length).toString('utf8');
      this.buffer = this.buffer.subarray(end + 4 + length);
      try {
        this.handle(JSON.parse(body) as DapMessage);
      } catch {
        // A malformed message is skipped.
      }
    }
  }

  private handle(message: DapMessage): void {
    if (message.type === 'response') {
      const p = this.pending.get(message.request_seq!);
      this.pending.delete(message.request_seq!);
      if (message.success) p?.resolve(message.body ?? {});
      else p?.reject(new Error(message.message || `${message.command} failed`));
    } else if (message.type === 'event') {
      this.onEvent(message.event!, message.body ?? {});
    } else {
      // Requests from the adapter (e.g. runInTerminal) aren't supported; say so rather than leave them hanging.
      this.send({ seq: this.seq++, type: 'response', request_seq: message.seq, command: message.command, success: false, message: 'Not supported by Saturn' });
    }
  }
}

interface Session {
  connection: DapConnection;
  child: ChildProcess;
  state: DebugState;
  threadId?: number;
  /** True once the adapter accepted breakpoints (after its "initialized" event). */
  configured: boolean;
}

export interface DebugEvents {
  changed(projectPath: string, state: DebugState): void;
  /** Program and debugger output for the Debug panel's console. */
  output(projectPath: string, text: string, category: string): void;
  message(projectPath: string, text: string, kind: MessageKind): void;
}

const IDLE: DebugState = { state: 'idle', frames: [], scopes: [] };

/** Replaces ${file}, ${project} and ${setting:<id>} in every string of a launch configuration. */
function fillLaunch(value: unknown, vars: { file: string; project: string }, owner: InstalledLanguage): unknown {
  if (typeof value === 'string') return fillSettings(owner, value.replace(/\$\{file\}/g, vars.file).replace(/\$\{project\}/g, vars.project));
  if (Array.isArray(value)) return value.map((v) => fillLaunch(v, vars, owner));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillLaunch(v, vars, owner)]));
  return value;
}

/**
 * Debug sessions, one per project window, through the debuggers language modules contribute (DAP).
 * Also keeps each project's breakpoints, sending them to a running session as they change.
 */
export class DebugService {
  private readonly sessions = new Map<string, Session>();
  private modules: InstalledLanguage[] = [];

  constructor(private readonly breakpoints: BreakpointStore, private readonly events: DebugEvents) {}

  setModules(modules: InstalledLanguage[]): void {
    this.modules = modules;
  }

  state(projectPath: string): DebugState {
    return this.sessions.get(projectPath)?.state ?? IDLE;
  }

  breakpointsFor(projectPath: string): Promise<Record<string, number[]>> {
    return this.breakpoints.forProject(projectPath);
  }

  async setBreakpoints(projectPath: string, path: string, lines: number[]): Promise<void> {
    await this.breakpoints.set(projectPath, path, lines);
    const session = this.sessions.get(projectPath);
    if (session?.configured) await this.sendBreakpoints(session, path, lines).catch(() => undefined);
  }

  /** Starts debugging a file with its language's debugger (stopping any session already running). */
  async start(projectPath: string, req: { path: string; languageId: string }): Promise<void> {
    await this.stop(projectPath);
    const owner = this.modules.find((m) => m.manifest.contributes?.debugger?.languages.includes(req.languageId));
    const config = owner?.manifest.contributes?.debugger;
    if (!owner || !config) throw new Error(`There's no debugger for this file's language`);

    const { child, command } = spawnModuleProcess(owner, config, projectPath);
    const session: Session = {
      child,
      configured: false,
      state: { state: 'starting', name: `${basename(req.path)} (${config.label})`, frames: [], scopes: [] },
      connection: new DapConnection(child, (event, body) => void this.onEvent(projectPath, session, event, body)),
    };
    this.sessions.set(projectPath, session);
    this.publish(projectPath, session);
    child.stderr!.on('data', (chunk: Buffer) => this.events.output(projectPath, chunk.toString(), 'stderr'));
    child.on('error', (e) => this.end(projectPath, session, `Couldn't start ${owner.manifest.name}'s debugger (${command}): ${e.message}`));
    child.on('exit', () => this.end(projectPath, session));

    try {
      await session.connection.request('initialize', {
        clientID: 'saturn', clientName: 'Saturn', adapterID: owner.manifest.id, locale: 'en',
        linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
        supportsVariableType: true, supportsRunInTerminalRequest: false,
      });
      session.state = { ...session.state, state: 'running' };
      this.publish(projectPath, session);
      await session.connection.request('launch', fillLaunch(config.launch, { file: req.path, project: projectPath }, owner));
    } catch (e) {
      this.end(projectPath, session, `Couldn't start debugging: ${(e as Error).message}`);
    }
  }

  async stop(projectPath: string): Promise<void> {
    const session = this.sessions.get(projectPath);
    if (!session) return;
    await Promise.race([
      session.connection.request('disconnect', { terminateDebuggee: true }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
    this.end(projectPath, session);
  }

  stopAll(): void {
    for (const [projectPath, session] of this.sessions) this.end(projectPath, session);
  }

  /** Continue, step over (next), step into, step out or pause the paused (or running) thread. */
  async control(projectPath: string, action: 'continue' | 'next' | 'stepIn' | 'stepOut' | 'pause'): Promise<void> {
    const session = this.sessions.get(projectPath);
    if (!session) return;
    const threadId = session.threadId ?? (await this.firstThread(session));
    if (threadId === undefined) return;
    if (action !== 'pause') {
      session.state = { ...session.state, state: 'running', reason: undefined, frames: [], scopes: [], frameId: undefined };
      this.publish(projectPath, session);
    }
    await session.connection.request(action, { threadId }).catch((e: Error) => this.events.message(projectPath, e.message, 'error'));
  }

  /** Shows another frame of the paused stack: its variables. */
  async selectFrame(projectPath: string, frameId: number): Promise<void> {
    const session = this.sessions.get(projectPath);
    if (!session || session.state.state !== 'stopped') return;
    session.state = { ...session.state, frameId, scopes: await this.scopes(session, frameId) };
    this.publish(projectPath, session);
  }

  /** A variable's children. */
  async variables(projectPath: string, ref: number): Promise<DebugVariable[]> {
    const session = this.sessions.get(projectPath);
    return session ? this.fetchVariables(session, ref) : [];
  }

  /** Evaluates an expression in the selected frame (the Debug console). */
  async evaluate(projectPath: string, expression: string): Promise<string> {
    const session = this.sessions.get(projectPath);
    if (!session) throw new Error('Nothing is being debugged');
    const body = await session.connection.request<{ result: string }>('evaluate', { expression, frameId: session.state.frameId, context: 'repl' });
    return body.result;
  }

  private async onEvent(projectPath: string, session: Session, event: string, body: any): Promise<void> {
    if (this.sessions.get(projectPath) !== session) return;
    switch (event) {
      case 'initialized': {
        // The adapter is ready for breakpoints; configurationDone then lets the program run.
        for (const [path, lines] of Object.entries(await this.breakpoints.forProject(projectPath))) {
          await this.sendBreakpoints(session, path, lines).catch(() => undefined);
        }
        session.configured = true;
        await session.connection.request('configurationDone').catch(() => undefined);
        break;
      }
      case 'stopped': {
        session.threadId = body.threadId ?? session.threadId ?? (await this.firstThread(session));
        const frames = session.threadId === undefined ? [] : await this.frames(session, session.threadId);
        const frameId = frames[0]?.id;
        session.state = { ...session.state, state: 'stopped', reason: body.reason, frames, frameId, scopes: frameId === undefined ? [] : await this.scopes(session, frameId) };
        this.publish(projectPath, session);
        break;
      }
      case 'continued':
        session.state = { ...session.state, state: 'running', reason: undefined, frames: [], scopes: [], frameId: undefined };
        this.publish(projectPath, session);
        break;
      case 'output':
        if (body.category !== 'telemetry' && body.output) this.events.output(projectPath, body.output, body.category ?? 'console');
        break;
      case 'terminated':
      case 'exited':
        if (event === 'exited') this.events.output(projectPath, `Process exited with code ${body.exitCode}\n`, 'console');
        void this.stop(projectPath);
        break;
    }
  }

  private sendBreakpoints(session: Session, path: string, lines: number[]): Promise<unknown> {
    return session.connection.request('setBreakpoints', { source: { path, name: basename(path) }, breakpoints: lines.map((line) => ({ line })), lines });
  }

  private async firstThread(session: Session): Promise<number | undefined> {
    const body = await session.connection.request<{ threads: { id: number }[] }>('threads').catch(() => ({ threads: [] }));
    return body.threads[0]?.id;
  }

  private async frames(session: Session, threadId: number): Promise<DebugFrame[]> {
    const body = await session.connection.request<{ stackFrames: { id: number; name: string; line: number; column: number; source?: { path?: string } }[] }>(
      'stackTrace', { threadId, startFrame: 0, levels: MAX_FRAMES },
    ).catch(() => ({ stackFrames: [] }));
    return body.stackFrames.map((f) => ({ id: f.id, name: f.name, path: f.source?.path ?? null, line: f.line, column: f.column }));
  }

  /** A frame's scopes and their variables (scopes the adapter marks expensive, e.g. globals, start empty). */
  private async scopes(session: Session, frameId: number): Promise<DebugScope[]> {
    const body = await session.connection.request<{ scopes: { name: string; variablesReference: number; expensive?: boolean }[] }>('scopes', { frameId })
      .catch(() => ({ scopes: [] }));
    return Promise.all(body.scopes.map(async (s) => ({ name: s.name, variables: s.expensive ? [] : await this.fetchVariables(session, s.variablesReference) })));
  }

  private async fetchVariables(session: Session, ref: number): Promise<DebugVariable[]> {
    const body = await session.connection.request<{ variables: { name: string; value: string; type?: string; variablesReference: number }[] }>(
      'variables', { variablesReference: ref },
    ).catch(() => ({ variables: [] }));
    return body.variables.map((v) => ({ name: v.name, value: v.value, type: v.type, ref: v.variablesReference }));
  }

  private end(projectPath: string, session: Session, problem?: string): void {
    if (this.sessions.get(projectPath) !== session) return;
    this.sessions.delete(projectPath);
    session.child.kill();
    if (problem) this.events.message(projectPath, problem, 'error');
    this.events.changed(projectPath, IDLE);
  }

  private publish(projectPath: string, session: Session): void {
    this.events.changed(projectPath, session.state);
  }
}
