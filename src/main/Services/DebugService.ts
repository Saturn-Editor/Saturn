import { execFile, type ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import type { MessageKind } from '@shared/modules';
import type { Breakpoint, DebugFrame, DebugScope, DebugState, DebugVariable, DebugWatch } from '@shared/types';
import type { BreakpointStore } from '../Store/BreakpointStore';
import type { InstalledLanguage } from './CodeModuleService';
import { fillSettings, spawnModuleProcess } from './LanguageServerService';
import { createSampler } from '../Helpers/processSampler';

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

  constructor(
    private readonly child: ChildProcess,
    private readonly onEvent: (event: string, body: any) => void,
    /** Requests the adapter makes of Saturn (runInTerminal); resolves to the response body, or rejects to refuse. */
    private readonly onRequest: (command: string, args: any) => Promise<unknown> = () => Promise.reject(new Error('Not supported by Saturn')),
  ) {
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
      const reply = (success: boolean, body?: unknown, error?: string) =>
        this.send({ seq: this.seq++, type: 'response', request_seq: message.seq, command: message.command, success, body, message: error });
      this.onRequest(message.command!, message.arguments).then((body) => reply(true, body ?? {}), (e: Error) => reply(false, undefined, e.message));
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
  sampler?: ReturnType<typeof setInterval>;
}

const SAMPLE_MS = 1000;
const METRIC_SAMPLES = 300;

export interface DebugEvents {
  changed(projectPath: string, state: DebugState): void;
  /** Program and debugger output for the Debug panel's console. */
  output(projectPath: string, text: string, category: string): void;
  message(projectPath: string, text: string, kind: MessageKind): void;
  /** Runs the program being debugged in a Terminal tab, so the user can type into it (Console.ReadLine, input()…). */
  runInTerminal(projectPath: string, title: string, command: string): void;
}

/** Quotes one argument for the user's shell. */
function shellQuote(arg: string): string {
  if (process.platform === 'win32') return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The command line for a DAP runInTerminal request: cd, environment, then the program and its arguments. */
function terminalCommand(args: { cwd?: string; args: string[]; env?: Record<string, string | null> }): string {
  const env = Object.entries(args.env ?? {}).filter(([, v]) => v !== null) as [string, string][];
  const program = args.args.map(shellQuote).join(' ');
  if (process.platform === 'win32') {
    const sets = env.map(([k, v]) => `set "${k}=${v}" && `).join('');
    return `${args.cwd ? `cd /d ${shellQuote(args.cwd)} && ` : ''}${sets}${program}`;
  }
  const assigns = env.map(([k, v]) => `${k}=${shellQuote(v)} `).join('');
  return `${args.cwd ? `cd ${shellQuote(args.cwd)} && ` : ''}${assigns}${program}`;
}

const IDLE: DebugState = { state: 'idle', frames: [], scopes: [], threads: [], watches: [] };

/**
 * Replaces ${file}, ${project}, ${processId} and ${setting:<id>} in every string of launch or attach
 * arguments. A string that is exactly "${processId}" becomes the number.
 */
function fillLaunch(value: unknown, vars: { file: string; project: string; processId: string }, owner: InstalledLanguage): unknown {
  if (value === '${processId}' && vars.processId) return Number(vars.processId);
  if (typeof value === 'string') {
    return fillSettings(owner, value.replace(/\$\{file\}/g, vars.file).replace(/\$\{project\}/g, vars.project).replace(/\$\{processId\}/g, vars.processId));
  }
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
  private readonly watchLists = new Map<string, string[]>();
  private readonly exceptionChoices = new Map<string, string[]>();

  constructor(private readonly breakpoints: BreakpointStore, private readonly events: DebugEvents) {}

  setModules(modules: InstalledLanguage[]): void {
    this.modules = modules;
  }

  state(projectPath: string): DebugState {
    return this.sessions.get(projectPath)?.state ?? IDLE;
  }

  breakpointsFor(projectPath: string): Promise<Record<string, Breakpoint[]>> {
    return this.breakpoints.forProject(projectPath);
  }

  async setBreakpoints(projectPath: string, path: string, list: Breakpoint[]): Promise<void> {
    await this.breakpoints.set(projectPath, path, list);
    const session = this.sessions.get(projectPath);
    if (session?.configured) await this.sendBreakpoints(session, path, list).catch(() => undefined);
  }

  /** Watch expressions, per project; re-evaluated whenever the program pauses or another frame is picked. */
  async setWatches(projectPath: string, expressions: string[]): Promise<void> {
    this.watchLists.set(projectPath, expressions);
    const session = this.sessions.get(projectPath);
    if (!session) return;
    session.state = { ...session.state, watches: await this.evaluateWatches(projectPath, session) };
    this.publish(projectPath, session);
  }

  /** Running processes to attach to (pid and name), most recent first. */
  async processes(): Promise<{ pid: number; name: string }[]> {
    const out = await new Promise<string>((resolve) => {
      if (process.platform === 'win32') execFile('tasklist', ['/fo', 'csv', '/nh'], (_e, stdout) => resolve(stdout ?? ''));
      else execFile('ps', ['-axo', 'pid=,comm='], (_e, stdout) => resolve(stdout ?? ''));
    });
    const list = out.split(/\r?\n/).map((line) => {
      if (process.platform === 'win32') {
        const [name, pid] = line.split('","').map((s) => s.replace(/"/g, ''));
        return { pid: Number(pid), name: name ?? '' };
      }
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      return { pid: Number(match?.[1]), name: (match?.[2] ?? '').split('/').pop() ?? '' };
    });
    return list.filter((p) => p.pid > 0 && p.pid !== process.pid && p.name).reverse();
  }

  /**
   * Starts debugging with the language's debugger (stopping any session already running): the file
   * with the default launch arguments or a named configuration, or (with `processId`) attaching to a
   * running process.
   */
  async start(projectPath: string, req: { path: string; languageId: string; configuration?: string; processId?: number; launch?: Record<string, unknown>; name?: string }): Promise<void> {
    await this.stop(projectPath);
    const owner = this.modules.find((m) => m.manifest.contributes?.debugger?.languages.includes(req.languageId));
    const config = owner?.manifest.contributes?.debugger;
    if (!owner || !config) throw new Error(`There's no debugger for this file's language`);
    if (req.processId !== undefined && !config.attach) throw new Error(`${config.label} can't attach to a running process`);
    const chosen = req.configuration ? config.configurations?.find((c) => c.id === req.configuration) : undefined;
    if (req.configuration && !chosen) throw new Error(`There's no ${req.configuration} configuration`);
    const title = req.name ?? (req.processId !== undefined ? `process ${req.processId}` : chosen ? chosen.label : basename(req.path));

    const { child, command } = spawnModuleProcess(owner, config, projectPath);
    const session: Session = {
      child,
      configured: false,
      state: { state: 'starting', name: `${title} (${config.label})`, frames: [], scopes: [], threads: [], watches: [] },
      connection: new DapConnection(child, (event, body) => void this.onEvent(projectPath, session, event, body), async (command, args) => {
        if (command !== 'runInTerminal') throw new Error('Not supported by Saturn');
        this.events.runInTerminal(projectPath, args.title || session.state.name || 'Debug', terminalCommand(args));
        return {};
      }),
    };
    this.sessions.set(projectPath, session);
    this.publish(projectPath, session);
    child.stderr!.on('data', (chunk: Buffer) => this.events.output(projectPath, chunk.toString(), 'stderr'));
    child.on('error', (e) => this.end(projectPath, session, `Couldn't start ${owner.manifest.name}'s debugger (${command}): ${e.message}`));
    child.on('exit', () => this.end(projectPath, session));

    try {
      const capabilities = await session.connection.request<{ exceptionBreakpointFilters?: { filter: string; label: string; description?: string; default?: boolean }[] }>('initialize', {
        clientID: 'saturn', clientName: 'Saturn', adapterID: owner.manifest.id, locale: 'en',
        linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
        supportsVariableType: true, supportsRunInTerminalRequest: true,
      });
      const picked = this.exceptionChoices.get(projectPath);
      const exceptionFilters = (capabilities?.exceptionBreakpointFilters ?? []).map((f) => ({
        id: f.filter, label: f.label, description: f.description, enabled: picked ? picked.includes(f.filter) : !!f.default,
      }));
      session.state = { ...session.state, state: 'running', exceptionFilters };
      this.publish(projectPath, session);
      const vars = { file: req.path, project: projectPath, processId: String(req.processId ?? '') };
      if (req.processId !== undefined) await session.connection.request('attach', fillLaunch(config.attach, vars, owner));
      else await session.connection.request('launch', fillLaunch(req.launch ?? chosen?.launch ?? config.launch, vars, owner));
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
      session.state = { ...session.state, state: 'running', reason: undefined, frames: [], scopes: [], frameId: undefined, threads: [] };
      this.publish(projectPath, session);
    }
    await session.connection.request(action, { threadId }).catch((e: Error) => this.events.message(projectPath, e.message, 'error'));
  }

  /** Shows another frame of the paused stack: its variables and watches. */
  async selectFrame(projectPath: string, frameId: number): Promise<void> {
    const session = this.sessions.get(projectPath);
    if (!session || session.state.state !== 'stopped') return;
    session.state = { ...session.state, frameId, scopes: await this.scopes(session, frameId) };
    session.state = { ...session.state, watches: await this.evaluateWatches(projectPath, session) };
    this.publish(projectPath, session);
  }

  /** Shows another thread of the paused program: its stack, top frame selected. */
  async selectThread(projectPath: string, threadId: number): Promise<void> {
    const session = this.sessions.get(projectPath);
    if (!session || session.state.state !== 'stopped') return;
    session.threadId = threadId;
    await this.showThread(projectPath, session);
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
        if (session.state.exceptionFilters?.length) await this.sendExceptionFilters(session).catch(() => undefined);
        session.configured = true;
        await session.connection.request('configurationDone').catch(() => undefined);
        break;
      }
      case 'stopped': {
        session.threadId = body.threadId ?? session.threadId ?? (await this.firstThread(session));
        session.state = { ...session.state, state: 'stopped', reason: body.reason };
        await this.showThread(projectPath, session);
        break;
      }
      case 'continued':
        session.state = { ...session.state, state: 'running', reason: undefined, frames: [], scopes: [], frameId: undefined, threads: [] };
        this.publish(projectPath, session);
        break;
      case 'process':
        if (typeof body.systemProcessId === 'number') this.startSampling(projectPath, session, body.systemProcessId);
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

  private sendBreakpoints(session: Session, path: string, list: Breakpoint[]): Promise<unknown> {
    const on = list.filter((b) => b.enabled !== false);
    return session.connection.request('setBreakpoints', {
      source: { path, name: basename(path) },
      breakpoints: on.map((b) => ({ line: b.line, ...(b.condition && { condition: b.condition }), ...(b.logMessage && { logMessage: b.logMessage }) })),
      lines: on.map((b) => b.line),
    });
  }

  private sendExceptionFilters(session: Session): Promise<unknown> {
    return session.connection.request('setExceptionBreakpoints', { filters: (session.state.exceptionFilters ?? []).filter((f) => f.enabled).map((f) => f.id) });
  }

  async setExceptionFilters(projectPath: string, ids: string[]): Promise<void> {
    this.exceptionChoices.set(projectPath, ids);
    const session = this.sessions.get(projectPath);
    if (!session?.state.exceptionFilters) return;
    session.state = { ...session.state, exceptionFilters: session.state.exceptionFilters.map((f) => ({ ...f, enabled: ids.includes(f.id) })) };
    this.publish(projectPath, session);
    if (session.configured) await this.sendExceptionFilters(session).catch(() => undefined);
  }

  /** The paused program's threads, the selected thread's stack (top frame selected), its variables and the watches. */
  private async showThread(projectPath: string, session: Session): Promise<void> {
    const threads = (await session.connection.request<{ threads: { id: number; name: string }[] }>('threads').catch(() => ({ threads: [] }))).threads;
    const frames = session.threadId === undefined ? [] : await this.frames(session, session.threadId);
    const frameId = frames[0]?.id;
    session.state = { ...session.state, threads, threadId: session.threadId, frames, frameId, scopes: frameId === undefined ? [] : await this.scopes(session, frameId) };
    session.state = { ...session.state, watches: await this.evaluateWatches(projectPath, session) };
    this.publish(projectPath, session);
  }

  private async evaluateWatches(projectPath: string, session: Session): Promise<DebugWatch[]> {
    const expressions = this.watchLists.get(projectPath) ?? [];
    if (session.state.state !== 'stopped') return expressions.map((expression) => ({ expression }));
    return Promise.all(expressions.map(async (expression) => {
      try {
        const body = await session.connection.request<{ result: string }>('evaluate', { expression, frameId: session.state.frameId, context: 'watch' });
        return { expression, value: body.result };
      } catch (e) {
        return { expression, error: (e as Error).message };
      }
    }));
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

  private startSampling(projectPath: string, session: Session, pid: number): void {
    clearInterval(session.sampler);
    const sample = createSampler(pid);
    const started = Date.now();
    session.state = { ...session.state, metrics: { pid, samples: [] } };
    session.sampler = setInterval(() => {
      void sample().then((s) => {
        if (!s || this.sessions.get(projectPath) !== session || !session.state.metrics) return;
        const samples = [...session.state.metrics.samples, { seconds: Math.round((Date.now() - started) / 1000), ...s }].slice(-METRIC_SAMPLES);
        session.state = { ...session.state, metrics: { pid, samples } };
        this.publish(projectPath, session);
      });
    }, SAMPLE_MS);
  }

  private end(projectPath: string, session: Session, problem?: string): void {
    if (this.sessions.get(projectPath) !== session) return;
    this.sessions.delete(projectPath);
    clearInterval(session.sampler);
    session.child.kill();
    if (problem) this.events.message(projectPath, problem, 'error');
    this.events.changed(projectPath, IDLE);
  }

  private publish(projectPath: string, session: Session): void {
    this.events.changed(projectPath, session.state);
  }
}
