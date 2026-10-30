import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node';
import type {
  CodeAction, CodeActionRequest, CodeLensItem, CompletionItem, InlayHint, SemanticToken, CompletionRequest, Diagnostic, DiagnosticSeverity, DocumentRequest, DocumentSymbol, FileEdits, MessageKind, ModuleMessage,
  NotificationAction, ReferenceLocation, SettingValues, SignatureHelp, SourceLocation, TextEdit, TextRange,
} from '@shared/modules';
import type { InstalledLanguage as InstalledModule } from './CodeModuleService';

interface Server {
  process: ChildProcess;
  connection: MessageConnection;
  ready: Promise<unknown>;
  /** Open documents (by URI) and the last version and text sent. */
  versions: Map<string, { version: number; text: string }>;
  diagnostics: Map<string, { range: LspRange }[]>;
  actions: (LspCodeAction | LspCommand)[];
  lenses: Map<string, { range: LspRange; command?: LspCommand; data?: unknown }[]>;
  legend: { tokenTypes: string[]; tokenModifiers: string[] } | null;
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

interface LspTextEdit {
  range: LspRange;
  newText: string;
}

/** DocumentSymbol (hierarchical) or the older flat SymbolInformation. */
type LspSymbol =
  | { name: string; detail?: string; kind: number; range: LspRange; selectionRange: LspRange; children?: LspSymbol[] }
  | { name: string; kind: number; location: { uri: string; range: LspRange }; containerName?: string };

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  /** TextDocumentEdits; file creates, renames and deletes (which have a `kind`) aren't supported. */
  documentChanges?: ({ textDocument: { uri: string }; edits: LspTextEdit[] } | { kind: string })[];
}

interface LspSignatureHelp {
  signatures: { label: string; documentation?: unknown; parameters?: { label: string | [number, number] }[]; activeParameter?: number }[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface LanguageServerEvents {
  /** A server published diagnostics for a file in a project. */
  diagnostics(projectPath: string, path: string, diagnostics: Diagnostic[]): void;
  /** Something the user should know, e.g. a server that failed to start. */
  message(message: ModuleMessage): void;
  /** A notification for the bell menu, e.g. a required tool that's missing. */
  notify(notification: { moduleId: string; title: string; message?: string; kind?: MessageKind; actions?: NotificationAction[] }): void;
  applyEdits(projectPath: string, files: FileEdits[]): Promise<void>;
}

const TOKEN_SCOPES: Record<string, string> = {
  namespace: 'entity.name.namespace',
  type: 'entity.name.type',
  class: 'entity.name.type.class',
  enum: 'entity.name.type.enum',
  interface: 'entity.name.type.interface',
  struct: 'entity.name.type.struct',
  typeParameter: 'entity.name.type.parameter',
  parameter: 'variable.parameter',
  variable: 'variable.other',
  property: 'variable.other.property',
  enumMember: 'variable.other.enummember',
  event: 'variable.other.event',
  function: 'entity.name.function',
  method: 'entity.name.function.member',
  macro: 'entity.name.function.preprocessor',
  keyword: 'keyword',
  modifier: 'storage.modifier',
  comment: 'comment',
  string: 'string',
  number: 'constant.numeric',
  regexp: 'string.regexp',
  operator: 'keyword.operator',
  decorator: 'entity.name.function.decorator',
};

/** What Saturn supports, so servers can adapt (LSP `initialize` client capabilities). */
const CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: { didSave: false, dynamicRegistration: false },
    completion: { completionItem: { snippetSupport: true, insertReplaceSupport: true } },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    definition: { linkSupport: true },
    publishDiagnostics: { relatedInformation: false },
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    references: {},
    rename: { prepareSupport: false },
    inlayHint: { resolveSupport: { properties: [] } },
    codeLens: {},
    semanticTokens: {
      requests: { full: true },
      tokenTypes: Object.keys(TOKEN_SCOPES),
      tokenModifiers: ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'],
      formats: ['relative'],
      multilineTokenSupport: false,
      overlappingTokenSupport: false,
    },
    codeAction: {
      codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } },
      resolveSupport: { properties: ['edit'] },
      dataSupport: true,
    },
    formatting: {},
    signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
  },
  workspace: { workspaceEdit: { documentChanges: true }, applyEdit: true },
};

interface LspCodeAction {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: LspWorkspaceEdit;
  command?: LspCommand | string;
  arguments?: unknown[];
  data?: unknown;
}

interface LspCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

function toFileEdits(edit: LspWorkspaceEdit | null | undefined): FileEdits[] {
  const byUri = new Map<string, LspTextEdit[]>(Object.entries(edit?.changes ?? {}));
  for (const change of edit?.documentChanges ?? []) {
    if ('textDocument' in change) byUri.set(change.textDocument.uri, [...(byUri.get(change.textDocument.uri) ?? []), ...change.edits]);
  }
  return [...byUri].filter(([uri]) => uri.startsWith('file:')).map(([uri, edits]) => ({ path: fileURLToPath(uri), edits: edits.map(toEdit) }));
}

const toEdit = (e: LspTextEdit): TextEdit => ({ range: toRange(e.range), newText: e.newText });

function toSymbol(s: LspSymbol): DocumentSymbol {
  if ('location' in s) return { name: s.name, detail: s.containerName, kind: s.kind, range: toRange(s.location.range), children: [] };
  return { name: s.name, detail: s.detail, kind: s.kind, range: toRange(s.selectionRange ?? s.range), children: (s.children ?? []).map(toSymbol) };
}

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
  if (c.language && c.value) return `\`\`\`${c.language}\n${c.value}\n\`\`\``;
  return c.value ?? '';
}

/** Replaces "${setting:<id>}" in a string with that module setting's value. */
export function fillSettings(owner: InstalledModule, s: string): string {
  return s.replace(/\$\{setting:([\w.-]+)\}/g, (_m, id: string) => String(owner.settings[id] ?? ''));
}

/** Starts a module's language server or debugger over stdio. */
export function spawnModuleProcess(owner: InstalledModule, config: { command: string; args?: string[] }, cwd: string): { child: ChildProcess; command: string } {
  const command = fillSettings(owner, config.command);
  // "node" runs on Saturn's own runtime, so users never need Node installed.
  const useSaturnNode = command === 'node';
  // Arguments that look like file paths resolve against the module folder (settings are used as given).
  const args = (config.args ?? []).map((a) => (a.includes('${setting:') ? fillSettings(owner, a) : /[\\/]|\.[cm]?js$/.test(a) ? join(owner.dir, a) : a));
  const child = spawn(useSaturnNode ? process.execPath : command, args, {
    cwd,
    // The module's storage folder (e.g. where it downloaded the real server) is passed on as SATURN_MODULE_STORAGE.
    env: { ...process.env, SATURN_MODULE_STORAGE: owner.storageDir, ...(useSaturnNode && { ELECTRON_RUN_AS_NODE: '1' }) },
    stdio: 'pipe',
    shell: !useSaturnNode && process.platform === 'win32',
  });
  return { child, command };
}

/**
 * Starts language servers (one per project and module), keeps them in sync with open files, and asks
 * them for completions, hovers, definitions, outlines, usages, renames, formatting and parameter hints.
 * Diagnostics they publish are forwarded to the window.
 */
export class LanguageServerService {
  private readonly servers = new Map<string, Server>();
  private modules: InstalledModule[] = [];
  /** Modules whose required tools were checked this session: true if all are present. */
  private readonly requirementChecks = new Map<string, Promise<boolean>>();

  constructor(private readonly events: LanguageServerEvents = { diagnostics: () => undefined, message: () => undefined, notify: () => undefined, applyEdits: async () => undefined }) {}

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

  /**
   * Stops a module's servers and forgets its tool checks, so they start again (checks included) on the
   * next request, e.g. after the module installed its server. Open files are re-sent as they're used.
   */
  restartModule(moduleId: string): void {
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
    const last = server.versions.get(uri);
    if (last?.text === req.text) return server;
    const version = (last?.version ?? 0) + 1;
    server.versions.set(uri, { version, text: req.text });
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

  /** Everything defined in a file, nested (classes containing methods…), for the Outline panel. */
  async symbols(projectPath: string, req: DocumentRequest): Promise<DocumentSymbol[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const result = (await server.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(req.path).href },
    }).catch(() => null)) as LspSymbol[] | null;
    return (result ?? []).filter((s) => !('location' in s) || s.location.uri === pathToFileURL(req.path).href).map(toSymbol);
  }

  /** Every usage of the symbol at a position (declaration included), with each line's text. */
  async references(projectPath: string, req: CompletionRequest): Promise<ReferenceLocation[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const result = (await server.connection.sendRequest('textDocument/references', {
      textDocument: { uri: pathToFileURL(req.path).href },
      position: { line: req.line, character: req.character },
      context: { includeDeclaration: true },
    }).catch(() => null)) as { uri: string; range: LspRange }[] | null;
    // Lines for the previews: the request's own text for its file, the saved file for the rest.
    const lines = new Map<string, Promise<string[]>>([[req.path, Promise.resolve(req.text.split(/\r?\n/))]]);
    const linesOf = (path: string) => {
      if (!lines.has(path)) lines.set(path, readFile(path, 'utf8').then((t) => t.split(/\r?\n/), () => []));
      return lines.get(path)!;
    };
    const found = (result ?? []).filter((r) => r.uri.startsWith('file:'));
    return Promise.all(found.map(async (r) => {
      const path = fileURLToPath(r.uri);
      return { path, range: toRange(r.range), preview: ((await linesOf(path))[r.range.start.line] ?? '').trim() };
    }));
  }

  /** The edits that rename the symbol at a position everywhere; rejects with the server's reason if it can't. */
  async rename(projectPath: string, req: CompletionRequest & { newName: string }): Promise<FileEdits[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const result = (await server.connection.sendRequest('textDocument/rename', {
      textDocument: { uri: pathToFileURL(req.path).href },
      position: { line: req.line, character: req.character },
      newName: req.newName,
    })) as LspWorkspaceEdit | null;
    return toFileEdits(result);
  }

  async inlayHints(projectPath: string, req: DocumentRequest & { fromLine: number; toLine: number }): Promise<InlayHint[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const result = (await server.connection.sendRequest('textDocument/inlayHint', {
      textDocument: { uri: pathToFileURL(req.path).href },
      range: { start: { line: req.fromLine, character: 0 }, end: { line: req.toLine + 1, character: 0 } },
    }).catch(() => null)) as { position: { line: number; character: number }; label: string | { value: string }[]; kind?: number; paddingLeft?: boolean; paddingRight?: boolean }[] | null;
    return (result ?? []).map((h) => ({
      line: h.position.line,
      character: h.position.character,
      label: typeof h.label === 'string' ? h.label : h.label.map((p) => p.value).join(''),
      kind: h.kind === 1 ? 'type' : h.kind === 2 ? 'parameter' : undefined,
      paddingLeft: h.paddingLeft,
      paddingRight: h.paddingRight,
    }));
  }

  async codeLenses(projectPath: string, req: DocumentRequest): Promise<CodeLensItem[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const uri = pathToFileURL(req.path).href;
    const result = (await server.connection.sendRequest('textDocument/codeLens', { textDocument: { uri } }).catch(() => null)) as
      { range: LspRange; command?: LspCommand; data?: unknown }[] | null;
    const lenses = await Promise.all((result ?? []).map(async (lens) => (lens.command ? lens
      : ((await server.connection.sendRequest('codeLens/resolve', lens).catch(() => lens)) as typeof lens))));
    server.lenses.set(uri, lenses);
    const isPosition = (v: unknown): v is { line: number; character: number } =>
      typeof v === 'object' && v !== null && typeof (v as { line?: unknown }).line === 'number' && typeof (v as { character?: unknown }).character === 'number';
    const needsSymbols = lenses.some((l) => l.command && !l.command.arguments?.some(isPosition));
    const symbols = needsSymbols ? await this.symbolRanges(server, uri) : [];
    const before = (a: { line: number; character: number }, b: { line: number; character: number }) => a.line < b.line || (a.line === b.line && a.character <= b.character);
    const nameAt = (range: LspRange) => symbols
      .filter((s) => before(s.range.start, range.start) && before(range.start, s.range.end))
      .sort((a, b) => (b.range.start.line - a.range.start.line) || (b.range.start.character - a.range.start.character))[0]?.selection;
    return lenses.flatMap((lens, index) => (lens.command?.title ? [{
      index,
      ...(lens.command.arguments?.find(isPosition) ?? nameAt(lens.range) ?? lens.range.start),
      lensLine: lens.range.start.line,
      title: lens.command.title,
      references: /references|usages/i.test(lens.command.command) || /^\d+\s+(references?|usages?)$/i.test(lens.command.title.trim()),
    }] : []));
  }

  private async symbolRanges(server: Server, uri: string): Promise<{ range: LspRange; selection: { line: number; character: number } }[]> {
    const result = (await server.connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } }).catch(() => null)) as LspSymbol[] | null;
    const flat: { range: LspRange; selection: { line: number; character: number } }[] = [];
    const walk = (list: LspSymbol[]) => {
      for (const s of list) {
        if ('location' in s) flat.push({ range: s.location.range, selection: s.location.range.start });
        else {
          flat.push({ range: s.range, selection: s.selectionRange.start });
          walk(s.children ?? []);
        }
      }
    };
    walk(result ?? []);
    return flat;
  }

  async runCodeLens(projectPath: string, languageId: string, path: string, index: number): Promise<void> {
    const server = await this.serverFor(projectPath, languageId);
    const command = server?.lenses.get(pathToFileURL(path).href)?.[index]?.command;
    if (!server || !command) return;
    await server.connection.sendRequest('workspace/executeCommand', { command: command.command, arguments: command.arguments });
  }

  async semanticTokens(projectPath: string, req: DocumentRequest): Promise<SemanticToken[]> {
    const server = await this.sync(projectPath, req);
    if (!server?.legend) return [];
    const result = (await server.connection.sendRequest('textDocument/semanticTokens/full', {
      textDocument: { uri: pathToFileURL(req.path).href },
    }).catch(() => null)) as { data: number[] } | null;
    const data = result?.data ?? [];
    const tokens: SemanticToken[] = [];
    let line = 0;
    let character = 0;
    for (let i = 0; i + 4 < data.length; i += 5) {
      line += data[i];
      character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
      const type = server.legend.tokenTypes[data[i + 3]];
      const scope = type ? TOKEN_SCOPES[type] : undefined;
      if (!scope) continue;
      const modifiers = server.legend.tokenModifiers.filter((_, bit) => data[i + 4] & (1 << bit));
      const scopes = [scope];
      if (modifiers.includes('readonly') || modifiers.includes('static')) scopes.push(`${scope}.${modifiers.includes('readonly') ? 'readonly' : 'static'}`);
      if (modifiers.includes('deprecated')) scopes.push('invalid.deprecated');
      tokens.push({ line, character, length: data[i + 2], scopes });
    }
    return tokens;
  }

  async codeActions(projectPath: string, req: CodeActionRequest): Promise<CodeAction[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const uri = pathToFileURL(req.path).href;
    const range = { start: { line: req.line, character: req.character }, end: { line: req.endLine, character: req.endCharacter } };
    const overlaps = (r: LspRange) => !(r.end.line < range.start.line || (r.end.line === range.start.line && r.end.character < range.start.character)
      || r.start.line > range.end.line || (r.start.line === range.end.line && r.start.character > range.end.character));
    const diagnostics = (server.diagnostics.get(uri) ?? []).filter((d) => overlaps(d.range));
    const result = (await server.connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri }, range, context: { diagnostics },
    }).catch(() => null)) as (LspCodeAction | LspCommand)[] | null;
    const actions = (result ?? []).filter((a) => !('disabled' in a && a.disabled));
    server.actions = actions;
    return actions.map((a, index) => ({
      index,
      title: a.title,
      kind: 'kind' in a ? a.kind : undefined,
      preferred: 'isPreferred' in a ? a.isPreferred : undefined,
    }));
  }

  async runCodeAction(projectPath: string, languageId: string, index: number): Promise<FileEdits[]> {
    const server = await this.serverFor(projectPath, languageId);
    let action = server?.actions[index];
    if (!server || !action) return [];
    if (typeof action.command === 'string') {
      await server.connection.sendRequest('workspace/executeCommand', { command: action.command, arguments: action.arguments });
      return [];
    }
    const literal = action as LspCodeAction;
    if (!literal.edit && !literal.command) {
      action = (await server.connection.sendRequest('codeAction/resolve', literal).catch(() => literal)) as LspCodeAction;
    }
    const resolved = action as LspCodeAction;
    const edits = toFileEdits(resolved.edit);
    const command = resolved.command as LspCommand | undefined;
    if (command) await server.connection.sendRequest('workspace/executeCommand', { command: command.command, arguments: command.arguments }).catch(() => undefined);
    return edits;
  }

  /** Edits that format the whole file in the language's style. */
  async format(projectPath: string, req: DocumentRequest & { tabSize: number; insertSpaces: boolean }): Promise<TextEdit[]> {
    const server = await this.sync(projectPath, req);
    if (!server) return [];
    const result = (await server.connection.sendRequest('textDocument/formatting', {
      textDocument: { uri: pathToFileURL(req.path).href },
      options: { tabSize: req.tabSize, insertSpaces: req.insertSpaces },
    }).catch(() => null)) as LspTextEdit[] | null;
    return (result ?? []).map(toEdit);
  }

  /** Parameter hints for the call around a position, or null outside a call. */
  async signatureHelp(projectPath: string, req: CompletionRequest): Promise<SignatureHelp | null> {
    const server = await this.sync(projectPath, req);
    if (!server) return null;
    const result = (await server.connection.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri: pathToFileURL(req.path).href },
      position: { line: req.line, character: req.character },
    }).catch(() => null)) as LspSignatureHelp | null;
    const signature = result?.signatures[result.activeSignature ?? 0] ?? result?.signatures[0];
    if (!signature) return null;
    const param = signature.parameters?.[signature.activeParameter ?? result?.activeParameter ?? 0]?.label;
    let activeParameter: [number, number] | null = null;
    if (Array.isArray(param)) activeParameter = param;
    else if (param) {
      const at = signature.label.indexOf(param);
      if (at >= 0) activeParameter = [at, at + param.length];
    }
    return { label: signature.label, documentation: hoverText(signature.documentation).trim() || undefined, activeParameter };
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
            // A notification (bell menu) offering the module's Settings tab and any install link in the hint.
            const link = r.install?.match(/https:\/\/\S+/)?.[0]?.replace(/[.,)]+$/, '');
            this.events.notify({
              moduleId: id,
              title: `${owner.manifest.name} needs ${r.name}`,
              message: `${r.name} wasn't found, so ${owner.manifest.name}'s language features are off.${r.install ? ` ${r.install}` : ''}`,
              kind: 'warning',
              actions: [
                ...(owner.manifest.contributes?.settings?.length ? [{ label: 'Open settings', openSettings: true }] : []),
                ...(link ? [{ label: 'Download', url: link }] : []),
              ],
            });
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

    const { child, command } = spawnModuleProcess(owner, config, projectPath);
    const connection = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!));
    const diagnostics = new Map<string, { range: LspRange }[]>();
    connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: { range: LspRange; severity?: number; message: string; source?: string }[] }) => {
      if (!params.uri.startsWith('file:')) return;
      diagnostics.set(params.uri, params.diagnostics);
      this.events.diagnostics(projectPath, fileURLToPath(params.uri), params.diagnostics.map((d) => ({
        ...toRange(d.range),
        severity: SEVERITIES[d.severity ?? 1] ?? 'error',
        message: d.message,
        source: d.source,
      })));
    });
    // Requests servers make of the client. Answer them (rather than leave them hanging) with what Saturn has.
    connection.onRequest('workspace/configuration', (params: { items?: unknown[] }) => (params.items ?? []).map(() => null));
    connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(projectPath).href, name: basename(projectPath) }]);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('client/unregisterCapability', () => null);
    connection.onRequest('workspace/applyEdit', async (params: { edit: LspWorkspaceEdit }) => ({
      applied: await this.events.applyEdits(projectPath, toFileEdits(params.edit)).then(() => true, () => false),
    }));
    connection.listen();
    const server: Server = { process: child, connection, ready: Promise.resolve(), versions: new Map(), diagnostics, actions: [], lenses: new Map(), legend: null };
    server.ready = connection
      .sendRequest('initialize', { processId: process.pid, rootUri: pathToFileURL(projectPath).href, capabilities: CLIENT_CAPABILITIES })
      .then((result) => {
        const legend = (result as { capabilities?: { semanticTokensProvider?: { legend?: Server['legend'] } } })?.capabilities?.semanticTokensProvider?.legend;
        server.legend = legend ?? null;
        return connection.sendNotification('initialized', {});
      });
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
