import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node';
import type { CompletionItem, CompletionRequest } from '@shared/modules';
import type { InstalledModule } from './ModuleService';

interface Server {
  process: ChildProcess;
  connection: MessageConnection;
  ready: Promise<unknown>;
  versions: Map<string, number>;
}

interface LspCompletionItem {
  label: string;
  detail?: string;
  insertText?: string;
  textEdit?: { newText: string };
  kind?: number;
}

/** Starts language servers (one per project and module) and asks them for completions over LSP. */
export class LanguageServerService {
  private readonly servers = new Map<string, Server>();
  private modules: InstalledModule[] = [];

  /** New module set: stops every server; they restart on next use. */
  setModules(modules: InstalledModule[]): void {
    this.modules = modules;
    this.stopAll();
  }

  async complete(projectPath: string, req: CompletionRequest): Promise<CompletionItem[]> {
    const server = this.serverFor(projectPath, req.languageId);
    if (!server) return [];
    await server.ready;
    const uri = pathToFileURL(req.path).href;
    const version = (server.versions.get(uri) ?? 0) + 1;
    server.versions.set(uri, version);
    if (version === 1) {
      void server.connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: req.languageId, version, text: req.text },
      });
    } else {
      void server.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: req.text }],
      });
    }
    const result = (await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line: req.line, character: req.character },
    })) as LspCompletionItem[] | { items: LspCompletionItem[] } | null;
    const items = Array.isArray(result) ? result : (result?.items ?? []);
    return items.map((i) => ({ label: i.label, detail: i.detail, kind: i.kind, insertText: i.textEdit?.newText ?? i.insertText }));
  }

  stopProject(projectPath: string): void {
    for (const [key, server] of this.servers) {
      if (key.startsWith(`${projectPath}\0`)) this.stop(key, server);
    }
  }

  stopAll(): void {
    for (const [key, server] of this.servers) this.stop(key, server);
  }

  private serverFor(projectPath: string, languageId: string): Server | null {
    const owner = this.modules.find((m) => m.manifest.contributes?.languageServer?.languages.includes(languageId));
    const config = owner?.manifest.contributes?.languageServer;
    if (!owner || !config) return null;
    const key = `${projectPath}\0${owner.manifest.id}`;
    const existing = this.servers.get(key);
    if (existing) return existing;

    // "node" runs on Saturn's own runtime, so users never need Node installed.
    const useSaturnNode = config.command === 'node';
    // Arguments that look like file paths resolve against the module folder.
    const args = (config.args ?? []).map((a) => (/[\\/]|\.[cm]?js$/.test(a) ? join(owner.dir, a) : a));
    const child = spawn(useSaturnNode ? process.execPath : config.command, args, {
      cwd: projectPath,
      env: useSaturnNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      stdio: 'pipe',
      shell: !useSaturnNode && process.platform === 'win32',
    });
    const connection = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!));
    connection.listen();
    const ready = connection
      .sendRequest('initialize', { processId: process.pid, rootUri: pathToFileURL(projectPath).href, capabilities: {} })
      .then(() => connection.sendNotification('initialized', {}));
    const server: Server = { process: child, connection, ready, versions: new Map() };
    child.on('exit', () => this.servers.get(key) === server && this.servers.delete(key));
    child.on('error', () => this.servers.delete(key));
    this.servers.set(key, server);
    return server;
  }

  private stop(key: string, server: Server): void {
    this.servers.delete(key);
    server.connection.dispose();
    server.process.kill();
  }
}
