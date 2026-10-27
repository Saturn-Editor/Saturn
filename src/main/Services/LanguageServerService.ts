import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node';
import type {
  CompletionItem, CompletionRequest, Diagnostic, DiagnosticSeverity, ModuleMessage, SettingValues, SourceLocation, TextRange,
} from '@shared/modules';
import type { InstalledModule } from './ModuleService';

interface Server {
  process: ChildProcess;
  connection: MessageConnection;
  ready: Promise<unknown>;
  /** Open documents (by URI) and their last version sent. */
  versions: Map<string, number>;
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspCompletionItem {
  label: string;
  detail?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: { newText: string; range?: LspRange; replace?: LspRange };
  kind?: number;
}

type LspLocation = { uri: string; range: LspRange } | { targetUri: string; targetSelectionRange?: LspRange; targetRange: LspRange };

export interface LanguageServerEvents {
  /** A server published diagnostics for a file in a project. */
  diagnostics(projectPath: string, path: string, diagnostics: Diagnostic[]): void;
  /** Something the user should know, e.g. a missing tool. */
  message(message: ModuleMessage): void;
}

/** What Saturn supports, so servers can adapt (LSP `initialize` client capabilities). */
const CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: { didSave: false, dynamicRegistration: false },
    completion: { completionItem: { snippetSupport: true, insertReplaceSupport: true } },
    hover: { contentFormat: ['plaintext', 'markdown'] },
    definition: { linkSupport: true },
    publishDiagnostics: { relatedInformation: false },
  },
  workspace: {},
};

const SEVERITIES: Record<number, DiagnosticSeverity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
const REQUIREMENT_TIMEOUT_MS = 10_000;

function toRange(r: LspRange): TextRange {
  return { line: r.start.line, character: r.start.character, endLine: r.end.line, endCharacter: r.end.character };
}

/** Hover contents (MarkupContent, MarkedString or an array of them) as plain text. */
function hoverText(contents: unknown): string {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n\n');
  const c = contents as { value?: string; language?: string };
  return c.value ?? '';
}

/**
 * Starts language servers (one per project and module), keeps them in sync with open files, and asks
 * them for completions, hovers and definitions. Diagnostics they publish are forwarded to the window.
 */
export class LanguageServerService {
  private readonly servers = new Map<string, Server>();
  private modules: InstalledModule[] = [];
  /** Modules whose required tools were checked this session: true if all are present. */
  private readonly requirementChecks = new Map<string, Promise<boolean>>();

  constructor(private readonly events: LanguageServerEvents = { diagnostics: () => undefined, message: () => undefined }) {}

  /** New module set: stops every server; they restart on next use. */
  setModules(modules: InstalledModule[]): void {
    this.modules = modules;
    this.requirementChecks.clear();
    this.stopAll();
  }

  /** A module's settings changed: its servers stop and restart on next use with the new values. */
  settingsChanged(moduleId: string, values: SettingValues): void {
    const owner = this.modules.find((m) => m.manifest.id === moduleId);
    if (!owner) return;
    owner.settings = values;
    this.requirementChecks.delete(moduleId);
    for (const [key, server] of this.servers) {
      if (key.endsWith(`\0${moduleId}`)) this.stop(key, server);
    }
  }

  /** Sends a file's current text to its language server (didOpen the first time, then didChange). */
  async sync(projectPath: string, req: { path: string; languageId: string; text: string }): Promise<Server | null> {
    const server = await this.serverFor(projectPath, req.languageId);
    if (!server) return null;
    await server.ready;
    const uri = pathToFileURL(req.path).href;
    const version = (server.versions.get(uri) ?? 0) + 1;
    server.versions.set(uri, version);
    if (version === 1) {
      void server.connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: req.languageId, version, text: req.text },
      });
    } else {
      void server.connection.sendNotification('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text: req.text }] });
    }
    return server;
  }

  /** The file's tab closed: tells its server (didClose). */
  close(projectPath: string, req: { path: string; languageId: string }): void {
    const owner = this.ownerOf(req.languageId);
    const server = owner && this.servers.get(`${projectPath}\0${owner.manifest.id}`);
    if (!server) return;
    const uri = pathToFileURL(req.path).href;
    if (!server.versions.delete(uri)) return;
    void server.ready.then(() => server.connection.sendNotification('textDocument/didClose', { textDocument: { uri } }));
  }

  async complete(projectPath: string, req: CompletionRequest): Promise<CompletionItem[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const result = (await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri: pathToFileURL(req.path).href },
      position: { line: req.line, character: req.character },
    })) as LspCompletionItem[] | { items: LspCompletionItem[] } | null;
    const items = Array.isArray(result) ? result : (result?.items ?? []);
    return items.map((i) => {
      const range = i.textEdit?.range ?? i.textEdit?.replace;
      return {
        label: i.label,
        detail: i.detail,
        kind: i.kind,
        insertText: i.textEdit?.newText ?? i.insertText,
        range: range ? toRange(range) : undefined,
        snippet: i.insertTextFormat === 2,
      };
    });
  }

  /** Hover text at a position, or null. */
  async hover(projectPath: string, req: CompletionRequest): Promise<string | null> {
    const server = await this.sync(projectPath, req);
    if (!server) return null;
    const result = (await server.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: pathToFileURL(req.path).href },
      position: { line: req.line, character: req.character },
    }).catch(() => null)) as { contents?: unknown } | null;
    const text = hoverText(result?.contents).trim();
    return text || null;
  }

  /** Where the symbol at a position is defined (the first location the server gives), or null. */
  async definition(projectPath: string, req: CompletionRequest): Promise<SourceLocation | null> {
    const server = await this.sync(projectPath, req);
    if (!server) return null;
    const result = (await server.connection.sendRequest('textDocument/definition', {
      textDocument: { uri: pathToFileURL(req.path).href },
      position: { line: req.line, character: req.character },
    }).catch(() => null)) as LspLocation | LspLocation[] | null;
    const first = Array.isArray(result) ? result[0] : result;
    if (!first) return null;
    const uri = 'uri' in first ? first.uri : first.targetUri;
    const range = 'uri' in first ? first.range : (first.targetSelectionRange ?? first.targetRange);
    if (!uri.startsWith('file:')) return null;
    return { path: fileURLToPath(uri), line: range.start.line + 1, column: range.start.character + 1 };
  }

  stopProject(projectPath: string): void {
    for (const [key, server] of this.servers) {
      if (key.startsWith(`${projectPath}\0`)) this.stop(key, server);
    }
  }

  stopAll(): void {
    for (const [key, server] of this.servers) this.stop(key, server);
  }

  private ownerOf(languageId: string): InstalledModule | undefined {
    return this.modules.find((m) => m.manifest.contributes?.languageServer?.languages.includes(languageId));
  }

  /** Runs each of the module's `requires` checks once per session; reports what's missing to the user. */
  private requirementsMet(owner: InstalledModule): Promise<boolean> {
    const id = owner.manifest.id;
    let check = this.requirementChecks.get(id);
    if (!check) {
      check = (async () => {
        for (const r of owner.manifest.requires ?? []) {
          const found = await new Promise<boolean>((resolve) => {
            execFile(r.command, r.args ?? [], { timeout: REQUIREMENT_TIMEOUT_MS, shell: process.platform === 'win32' }, (error) => resolve(!error));
          });
          if (!found) {
            const message = `${owner.manifest.name} needs ${r.name}, which wasn't found.${r.install ? ` ${r.install}` : ''}`;
            this.events.message({ message, kind: 'warning', moduleId: id });
            return false;
          }
        }
        return true;
      })();
      this.requirementChecks.set(id, check);
    }
    return check;
  }

  private async serverFor(projectPath: string, languageId: string): Promise<Server | null> {
    const owner = this.ownerOf(languageId);
    const config = owner?.manifest.contributes?.languageServer;
    if (!owner || !config) return null;
    const key = `${projectPath}\0${owner.manifest.id}`;
    const existing = this.servers.get(key);
    if (existing) return existing;
    if (!(await this.requirementsMet(owner))) return null;
    // Another call may have started it while the requirements were checked.
    const started = this.servers.get(key);
    if (started) return started;

    // "${setting:jarPath}" in the command or an argument is replaced by that module setting's value.
    const fill = (s: string) => s.replace(/\$\{setting:([\w.-]+)\}/g, (_m, id: string) => String(owner.settings[id] ?? ''));
    const command = fill(config.command);
    // "node" runs on Saturn's own runtime, so users never need Node installed.
    const useSaturnNode = command === 'node';
    // Arguments that look like file paths resolve against the module folder (settings are used as given).
    const args = (config.args ?? []).map((a) => (a.includes('${setting:') ? fill(a) : /[\\/]|\.[cm]?js$/.test(a) ? join(owner.dir, a) : a));
    const child = spawn(useSaturnNode ? process.execPath : command, args, {
      cwd: projectPath,
      env: useSaturnNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      stdio: 'pipe',
      shell: !useSaturnNode && process.platform === 'win32',
    });
    const connection = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!));
    connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: { range: LspRange; severity?: number; message: string; source?: string }[] }) => {
      if (!params.uri.startsWith('file:')) return;
      this.events.diagnostics(projectPath, fileURLToPath(params.uri), params.diagnostics.map((d) => ({
        ...toRange(d.range),
        severity: SEVERITIES[d.severity ?? 1] ?? 'error',
        message: d.message,
        source: d.source,
      })));
    });
    connection.listen();
    const ready = connection
      .sendRequest('initialize', { processId: process.pid, rootUri: pathToFileURL(projectPath).href, capabilities: CLIENT_CAPABILITIES })
      .then(() => connection.sendNotification('initialized', {}));
    const server: Server = { process: child, connection, ready, versions: new Map() };
    child.on('exit', () => this.servers.get(key) === server && this.servers.delete(key));
    child.on('error', (e) => {
      this.servers.delete(key);
      this.events.message({ message: `Couldn't start ${owner.manifest.name}'s language server (${command}): ${e.message}`, kind: 'error', moduleId: owner.manifest.id });
    });
    this.servers.set(key, server);
    return server;
  }

  private stop(key: string, server: Server): void {
    this.servers.delete(key);
    server.connection.dispose();
    server.process.kill();
  }
}
