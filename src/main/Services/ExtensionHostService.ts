import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { RUN_PROVIDER, TESTS_PROVIDER, documentProvider, moduleFilesGlob, projectTypeProvider, versionsProvider, type ExtensionManifest, type SearchResult, type DocCommentRequest, type InputOptions, type LanguageVersion, type SymbolRename, type LanguageVersionChoices, type TestDebugLaunch, type TestEvent, type TestGroup, type EditorEvent, type EditorFile, type LanguageManifest, type MessageKind, type ModuleMessage, type NotificationAction, type SettingValues, type TreeItem } from '@shared/modules';
import type { NotebookLock } from '@shared/notebooks';
import { Rpc } from '@shared/rpc';
import type { InstalledModule } from './CodeModuleService';

export interface HostEvents {
  openFile(projectPath: string, path: string, line?: number, column?: number): void;
  refreshPanel(panelId: string, itemId?: string): void;
  showMessage(message: ModuleMessage): void;
  runInTerminal(projectPath: string, name: string, command: string): void;
  restartLanguageServer(moduleId: string): void;
  notify(notification: { moduleId: string; title: string; message?: string; kind?: MessageKind; actions?: NotificationAction[] }): void;
  crashed(reason: string): void;
  /** A module sent its webview panel a message: to that project's window, or every window when null. */
  webviewPost(panelId: string, projectPath: string | null, message: unknown): void;
  /** A module asked for its webview panel's HTML to be loaded again. */
  webviewRefresh(panelId: string): void;
  testEvent(projectPath: string, event: TestEvent): void;
  languageVersion(projectPath: string, languageId: string): Promise<LanguageVersion | null>;
  showInput(projectPath: string, options: InputOptions): Promise<string | null>;
  renameFile(projectPath: string, path: string, newName: string): Promise<string>;
  documentSetText(path: string, text: string): void;
  documentPost(path: string, message: unknown): void;
  showOpenDialog(projectPath: string, options: { title?: string; filters?: DialogFilter[]; multiple?: boolean }): Promise<string[] | null>;
  showSaveDialog(projectPath: string, options: { title?: string; defaultName?: string; filters?: DialogFilter[] }): Promise<string | null>;
  encryptionState(projectPath: string): Promise<NotebookLock>;
  encryptText(projectPath: string, text: string): Promise<string>;
  decryptText(projectPath: string, text: string): Promise<string>;
  sandboxRun(code: string, timeout?: number): Promise<unknown>;
}

export interface DialogFilter {
  name: string;
  extensions: string[];
}

type Ctx = { projectPath: string };

/** How long modules get to run `deactivate()` before the host is stopped anyway. */
const DEACTIVATE_TIMEOUT_MS = 1500;

/** Runs the extension host process and forwards calls to the modules loaded in it. */
export class ExtensionHostService {
  private child: UtilityProcess | null = null;
  private rpc: Rpc | null = null;
  private ready: Promise<void> = Promise.resolve();
  /** Progress listeners for New Project creations in flight, by id. */
  private readonly createProgress = new Map<string, (message: string) => void>();
  private nextCreateId = 0;

  constructor(private readonly events: HostEvents) {}

  /** (Re)starts the host with the given modules, letting the old ones deactivate first. Calls made meanwhile wait for activation. */
  async restart(modules: InstalledModule[]): Promise<void> {
    let starting!: () => void;
    const previous = this.ready;
    this.ready = new Promise<void>((resolve) => (starting = resolve));
    await previous.catch(() => undefined);
    try {
      await this.start(modules);
    } finally {
      starting();
    }
  }

  private async start(modules: InstalledModule[]): Promise<void> {
    await this.shutdown();
    const child = utilityProcess.fork(join(import.meta.dirname, 'host.js'), [], { serviceName: 'Saturn Extension Host' });
    const rpc = new Rpc((message) => child.postMessage(message));
    rpc.handle('openFile', (projectPath: string, path: string, line?: number, column?: number) => this.events.openFile(projectPath, path, line, column));
    rpc.handle('refreshPanel', (panelId: string, itemId?: string) => this.events.refreshPanel(panelId, itemId));
    rpc.handle('showMessage', (message: ModuleMessage) => this.events.showMessage(message));
    rpc.handle('notify', (n: Parameters<HostEvents['notify']>[0]) => this.events.notify(n));
    rpc.handle('restartLanguageServer', (moduleId: string) => this.events.restartLanguageServer(moduleId));
    rpc.handle('runInTerminal', (projectPath: string, name: string, command: string) => this.events.runInTerminal(projectPath, name, command));
    rpc.handle('createProgress', (createId: string, message: string) => this.createProgress.get(createId)?.(message));
    rpc.handle('webviewPost', (panelId: string, projectPath: string | null, message: unknown) => this.events.webviewPost(panelId, projectPath, message));
    rpc.handle('webviewRefresh', (panelId: string) => this.events.webviewRefresh(panelId));
    rpc.handle('testEvent', (projectPath: string, event: TestEvent) => this.events.testEvent(projectPath, event));
    rpc.handle('languageVersion', (projectPath: string, languageId: string) => this.events.languageVersion(projectPath, languageId));
    rpc.handle('showInput', (projectPath: string, options: InputOptions) => this.events.showInput(projectPath, options));
    rpc.handle('renameFile', (projectPath: string, path: string, newName: string) => this.events.renameFile(projectPath, path, newName));
    rpc.handle('documentSetText', (path: string, text: string) => this.events.documentSetText(path, text));
    rpc.handle('documentPost', (path: string, message: unknown) => this.events.documentPost(path, message));
    rpc.handle('showOpenDialog', (projectPath: string, options: Parameters<HostEvents['showOpenDialog']>[1]) => this.events.showOpenDialog(projectPath, options));
    rpc.handle('showSaveDialog', (projectPath: string, options: Parameters<HostEvents['showSaveDialog']>[1]) => this.events.showSaveDialog(projectPath, options));
    rpc.handle('encryptionState', (projectPath: string) => this.events.encryptionState(projectPath));
    rpc.handle('encryptText', (projectPath: string, text: string) => this.events.encryptText(projectPath, text));
    rpc.handle('decryptText', (projectPath: string, text: string) => this.events.decryptText(projectPath, text));
    rpc.handle('sandboxRun', (code: string, timeout?: number) => this.events.sandboxRun(code, timeout));
    child.on('message', (message) => rpc.receive(message));
    child.on('exit', (code) => {
      rpc.rejectAll('The extension host stopped');
      if (this.child === child) {
        this.child = null;
        this.rpc = null;
        this.events.crashed(`The extension host stopped (code ${code}). Languages are unavailable until Saturn restarts them.`);
      }
    });
    this.child = child;
    this.rpc = rpc;
    const loadable = modules.map((m) => {
      const c = m.manifest.contributes as LanguageManifest['contributes'];
      const provides = [
        ...(c?.commands ?? []), ...(c?.panels ?? []), ...(c?.previews ?? []), ...(c?.fileTemplates ?? []),
      ].map((x) => x.id);
      if (c?.runConfigurations) provides.push(RUN_PROVIDER);
      if (c?.tests) provides.push(TESTS_PROVIDER);
      for (const language of c?.languages ?? []) if (language.versions) provides.push(versionsProvider(language.id));
      const ec = m.manifest.contributes as ExtensionManifest['contributes'];
      for (const d of ec?.documents ?? []) provides.push(documentProvider(d.id));
      for (const t of ec?.projectTypes ?? []) provides.push(projectTypeProvider(t.id));
      const languages = (c?.languages ?? []).map((l) => l.id);
      const watch = [
        ...(c?.languages ?? []).map((l) => moduleFilesGlob(l.extensions)),
        ...(ec?.documents ?? []).map((d) => moduleFilesGlob(d.extensions)),
        ...(ec?.projectTypes ?? []).map((t) => t.marker),
      ].filter((g): g is string => !!g);
      return { id: m.manifest.id, dir: m.dir, main: m.manifest.main, settings: m.settings, storageDir: m.storageDir, startup: m.manifest.startup ?? 'dynamic', provides, languages, watch };
    });
    // Open files are known before modules activate, so `saturn.editor` answers from the start.
    for (const [projectPath, state] of this.editors) {
      for (const file of state.files.values()) rpc.notify('editorEvent', projectPath, { type: 'file', file });
      rpc.notify('editorEvent', projectPath, state.active);
    }
    await rpc.call<{ id: string; error: string }[]>('activate', loadable).then(
      (failures) => failures.forEach((f) => console.error(`Module ${f.id} failed to activate: ${f.error}`)),
      (e) => console.error('Extension host failed to activate modules', e),
    );
  }

  /**
   * What each editor window reports about its open files, active file and selection. Kept here too so
   * a restarted host is given the current state before modules activate.
   */
  private readonly editors = new Map<string, { files: Map<string, EditorFile>; active: EditorEvent }>();

  editorEvent(projectPath: string, event: EditorEvent): void {
    const state = this.editors.get(projectPath) ?? { files: new Map(), active: { type: 'active', path: null, selection: null } };
    if (event.type === 'file') state.files.set(event.file.path, event.file);
    else if (event.type === 'closed') state.files.delete(event.path);
    else state.active = event;
    this.editors.set(projectPath, state);
    this.rpc?.notify('editorEvent', projectPath, event);
  }

  webviewHtml(panelId: string, ctx: Ctx): Promise<string> {
    return this.call('webviewHtml', panelId, ctx);
  }

  webviewMessage(panelId: string, message: unknown, ctx: Ctx): Promise<void> {
    return this.call('webviewMessage', panelId, message, ctx);
  }

  /** Asks modules to `deactivate()` (waiting a moment at most), then stops the host. */
  async shutdown(): Promise<void> {
    const rpc = this.rpc;
    if (rpc) await Promise.race([rpc.call('deactivate').catch(() => undefined), new Promise((r) => setTimeout(r, DEACTIVATE_TIMEOUT_MS))]);
    this.stop();
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.rpc?.rejectAll('The extension host restarted');
    this.rpc = null;
    child?.kill();
  }

  /** Passes a module's new setting values to it (modules listen with `saturn.settings.onChange`). */
  settingsChanged(moduleId: string, values: SettingValues): void {
    void this.ready.then(() => this.rpc?.notify('settingsChanged', moduleId, values));
  }

  /** Files changed in an open project (modules listen with `saturn.workspace.onDidChangeFiles`). */
  filesChanged(projectPath: string, dir: string): void {
    void this.ready.then(() => this.rpc?.notify('filesChanged', projectPath, dir));
  }

  /** A project opened in an editor window (modules listen with `saturn.projects.onDidOpen`). */
  projectOpened(projectPath: string): void {
    void this.ready.then(() => this.rpc?.notify('projectOpened', projectPath));
  }

  /** A project's editor window closed (modules listen with `saturn.projects.onDidClose`). */
  projectClosed(projectPath: string): void {
    this.editors.delete(projectPath);
    void this.ready.then(() => this.rpc?.notify('projectClosed', projectPath));
  }

  treeAction(panelId: string, actionId: string, item: TreeItem, ctx: Ctx): Promise<void> {
    return this.call('treeAction', panelId, actionId, item, ctx);
  }

  runCommand(id: string, ctx: Ctx): Promise<void> {
    return this.call('runCommand', id, ctx);
  }

  testsDiscover(ctx: Ctx): Promise<TestGroup[]> {
    return this.call('testsDiscover', ctx);
  }

  testsRun(controllerId: string, ids: string[] | null, runId: string, ctx: Ctx, coverage = false): Promise<void> {
    return this.call('testsRun', controllerId, ids, runId, ctx, coverage);
  }

  languageVersions(languageId: string, ctx: Ctx): Promise<LanguageVersionChoices> {
    return this.call('versionsList', languageId, ctx);
  }

  languageVersionAdd(languageId: string, folder: string, ctx: Ctx): Promise<LanguageVersion> {
    return this.call('versionsAdd', languageId, folder, ctx);
  }

  languageVersionChanged(languageId: string, version: LanguageVersion, ctx: Ctx): Promise<void> {
    return this.call('versionsChanged', languageId, version, ctx);
  }

  testsCancel(runId: string): Promise<void> {
    return this.call('testsCancel', runId);
  }

  testsDebug(controllerId: string, ids: string[] | null, ctx: Ctx): Promise<TestDebugLaunch> {
    return this.call('testsDebug', controllerId, ids, ctx);
  }

  treeChildren(panelId: string, parentId: string | null, ctx: Ctx): Promise<TreeItem[]> {
    return this.call('treeChildren', panelId, parentId, ctx);
  }

  renderPreview(id: string, text: string, ctx: Ctx & { path: string }): Promise<string> {
    return this.call('renderPreview', id, text, ctx);
  }

  templateFile(id: string, ctx: Ctx & { name: string; dir: string }): Promise<{ fileName: string | null; content: string }> {
    return this.call('templateFile', id, ctx);
  }

  /** Runs the language's onCreate (which may take a while); `onProgress` hears its `ctx.progress` messages. */
  async createProject(moduleId: string, ctx: Ctx & { fields: Record<string, string | boolean> }, onProgress?: (message: string) => void): Promise<void> {
    const createId = String(++this.nextCreateId);
    if (onProgress) this.createProgress.set(createId, onProgress);
    try {
      await this.call('createProject', moduleId, { ...ctx, createId });
    } finally {
      this.createProgress.delete(createId);
    }
  }

  documentHtml(id: string, ctx: Ctx & { path: string; text: string }): Promise<string> {
    return this.call('documentHtml', id, ctx);
  }

  documentMessage(id: string, message: unknown, ctx: Ctx & { path: string }): Promise<void> {
    return this.call('documentMessage', id, message, ctx);
  }

  createProjectType(id: string, ctx: Ctx & { name: string }): Promise<void> {
    return this.call('createProjectType', id, ctx);
  }

  search(query: string, ctx: Ctx): Promise<(SearchResult & { moduleId: string })[]> {
    return this.call('searchQuery', query, ctx);
  }

  searchOpen(moduleId: string, id: string, ctx: Ctx): Promise<void> {
    return this.call('searchOpen', moduleId, id, ctx);
  }

  encryptionWillRemove(projectPath: string): Promise<void> {
    return this.call('encryptionWillRemove', projectPath);
  }

  encryptionChanged(projectPath: string, state: NotebookLock): void {
    void this.ready.then(() => this.rpc?.notify('encryptionChanged', projectPath, state));
  }

  symbolRenamed(event: SymbolRename, ctx: Ctx): Promise<void> {
    return this.call('symbolRenamed', event, ctx);
  }

  docComment(languageId: string, request: DocCommentRequest, ctx: Ctx): Promise<string | null> {
    return this.call('docComment', languageId, request, ctx);
  }

  runEntries(ctx: Ctx): Promise<{ moduleId: string; name: string; command: string }[]> {
    return this.call('runEntries', ctx);
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.ready;
    if (!this.rpc) throw new Error('The extension host is not running');
    return this.rpc.call<T>(method, ...args);
  }
}
