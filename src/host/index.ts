/**
 * The extension host: a separate process that loads enabled modules and runs their code, so a slow
 * or crashing module can never freeze the editor. Main talks to it over an Rpc channel.
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { RUN_PROVIDER, TESTS_PROVIDER, versionsProvider, type DocCommentRequest, type InputOptions, type SymbolRename, type LanguageVersion, type FileCoverage, type TestDebugLaunch, type TestEvent, type TestGroup, type TestItem, type TestResult, type EditorEvent, type EditorFile, type EditorSelection, type MessageKind, type NotificationAction, type SettingValue, type SettingValues, type TreeItem } from '@shared/modules';
import { Rpc } from '@shared/rpc';
import { findFiles } from '../main/Helpers/findFiles';

export interface ModuleContext {
  projectPath: string;
}

export interface TemplateContext extends ModuleContext {
  name: string;
  dir: string;
}

export interface TreeProvider {
  getChildren(parentId: string | null, ctx: ModuleContext): TreeItem[] | Promise<TreeItem[]>;
  /** Called when the user picks one of an item's `actions` from its right-click menu. */
  onAction?(actionId: string, item: TreeItem, ctx: ModuleContext): void | Promise<void>;
}

/** The `saturn` object every module's `activate(saturn)` receives. A module may also export `deactivate()`, called before it unloads. */
export interface SaturnModuleApi {
  platform: NodeJS.Platform;
  /**
   * A writable folder for this module that survives updates (e.g. downloaded tools such as a language
   * server). Created before activate(); removed on uninstall. Its language server also gets it as
   * the SATURN_MODULE_STORAGE environment variable.
   */
  storagePath: string;
  commands: { register(id: string, run: (ctx: ModuleContext) => void | Promise<void>): void };
  panels: {
    registerTree(id: string, provider: TreeProvider): void;
    /** Reloads the whole tree, or only the children of `itemId`. */
    refresh(id: string, itemId?: string): void;
  };
  previews: { registerRenderer(id: string, render: (text: string, ctx: ModuleContext & { path: string }) => string | Promise<string>): void };
  files: {
    registerTemplate(id: string, template: {
      fileName?(ctx: TemplateContext): string;
      content?(ctx: TemplateContext): string | Promise<string>;
    }): void;
  };
  projects: {
    /**
     * Fills in a new project's folder (`ctx.projectPath`, already created). May be async: Saturn shows
     * "Creating…" until it settles, and `ctx.progress("Restoring packages…")` updates that text. Throwing
     * (or rejecting) shows the message on the New Project page and removes the folder. `fields` holds
     * the fields that apply, plus `tab` and `template` when the language has template tabs.
     */
    onCreate(handler: (ctx: ModuleContext & { fields: Record<string, string | boolean>; progress(message: string): void }) => void | Promise<void>): void;
    /** A project's editor window closed; release anything held for it (watchers, caches). */
    onDidClose(listener: (ctx: ModuleContext) => void): void;
    /** A project opened in an editor window. Also fires, just after activate(), for projects already open. */
    onDidOpen(listener: (ctx: ModuleContext) => void): void;
  };
  run: { registerProvider(provide: (ctx: ModuleContext) => { name: string; command: string }[] | Promise<{ name: string; command: string }[]>): void };
  workspace: {
    findFiles(projectPath: string, glob: string): Promise<string[]>;
    /** Opens a file in that project's editor window, at a 1-based line and column. */
    openFile(projectPath: string, path: string, line?: number, column?: number): void;
    /** Files changed inside an open project: `dir` is the folder whose contents changed (debounced). */
    onDidChangeFiles(listener: (e: { projectPath: string; dir: string }) => void): void;
    renameFile(projectPath: string, path: string, newName: string): Promise<string>;
  };
  window: {
    /** Shows a message in the status bar: of that project's window if given, otherwise every window. */
    showMessage(message: string, options?: { kind?: MessageKind; projectPath?: string }): void;
    /**
     * Adds a notification to the bell menu next to Settings. Actions can run one of this module's
     * commands, open its Settings tab, or open an https link.
     */
    notify(notification: { title: string; message?: string; kind?: MessageKind; actions?: NotificationAction[] }): void;
    showInput(projectPath: string, options: InputOptions): Promise<string | null>;
  };
  languageServer: {
    /** Restarts this module's language server (and re-checks `requires`), e.g. after installing it. */
    restart(): void;
  };
  /**
   * Versions of a language the project can use (e.g. JDKs), picked per project from the language
   * name in the status bar, which then reads e.g. "Java 17". Needs `"versions": true` on the language
   * in the manifest. `add` (with `addLabel`, e.g. "Add JDK…") is offered with a folder picker.
   * `onChange` is told about each choice; reconfigure or restart the language server there.
   */
  languages: {
    registerVersions(languageId: string, provider: {
      list(ctx: ModuleContext): LanguageVersion[] | Promise<LanguageVersion[]>;
      addLabel?: string;
      add?(ctx: ModuleContext & { folder: string }): LanguageVersion | Promise<LanguageVersion>;
      onChange?(ctx: ModuleContext & { version: LanguageVersion }): void | Promise<void>;
    }): void;
    getVersion(projectPath: string, languageId: string): Promise<LanguageVersion | null>;
    onDidRenameSymbol(listener: (e: ModuleContext & SymbolRename) => void): void;
    registerDocComment(languageId: string, provide: (request: ModuleContext & DocCommentRequest) => string | null | Promise<string | null>): void;
  };
  terminal: {
    /** Runs a shell command in a new Terminal tab of that project's window (interactive, with Stop), e.g. "dotnet run". */
    run(projectPath: string, options: { name: string; command: string }): void;
  };
  /** This module's own settings (declared in `contributes.settings`, edited in its Settings tab). */
  settings: {
    get(id: string): SettingValue | undefined;
    onChange(listener: (values: SettingValues) => void): void;
  };
  /**
   * The files open in a project's editor window, with their current text (unsaved edits included),
   * and the focused editor's file and selection. Changes arrive shortly after typing pauses.
   */
  editor: {
    /** The focused editor's file and its selection (or cursor), or null when no file is showing. */
    activeFile(projectPath: string): (EditorFile & { selection: EditorSelection | null }) | null;
    openFiles(projectPath: string): EditorFile[];
    /** An open file by path, or null if it isn't open. */
    file(projectPath: string, path: string): EditorFile | null;
    /** The focused editor showed another file (or none). */
    onDidChangeActive(listener: (e: ModuleContext & { file: (EditorFile & { selection: EditorSelection | null }) | null }) => void): void;
    /** The selection or cursor moved in the focused editor. */
    onDidChangeSelection(listener: (e: ModuleContext & { path: string; selection: EditorSelection }) => void): void;
    /** An open file's text changed, or a file was opened. */
    onDidChangeFile(listener: (e: ModuleContext & { file: EditorFile }) => void): void;
    /** A file's tab closed. */
    onDidCloseFile(listener: (e: ModuleContext & { path: string }) => void): void;
  };
  /**
   * Panels with the module's own HTML (manifest `panels` entries with `"kind": "webview"`). The page
   * runs sandboxed (scripts, no network or Node); it calls `saturn.postMessage(message)` to reach
   * `onMessage`, and `saturn.onMessage(callback)` hears `postMessage` below. Saturn's theme colours
   * are CSS variables in it (`--saturn-text`, `--saturn-accent`…).
   */
  webviews: {
    register(panelId: string, provider: {
      html(ctx: ModuleContext): string | Promise<string>;
      onMessage?(message: unknown, ctx: ModuleContext): void | Promise<void>;
    }): void;
    /** Sends the panel a message: in that project's window, or in every window when projectPath is left out. */
    postMessage(panelId: string, message: unknown, projectPath?: string): void;
    /** Loads the panel's HTML again. */
    refresh(panelId: string): void;
  };
  /**
   * Tests for the Tests panel. `discover` returns the project's tests as a tree; `run` runs the given
   * test ids (null for all), calling `report` as each test starts and finishes and `output` for its log.
   * `signal` aborts when the user presses Stop: end the test process then. A result for a test that
   * discover didn't find (e.g. a `test.each` case) is added to the tree when it has a `label`, under
   * `parentId` if given. Controllers with `supportsCoverage` get "Run with coverage": `coverage` is then
   * true and they call `reportCoverage` with each file's covered and uncovered 1-based lines.
   * Needs `"tests": true` under `contributes` in the manifest.
   */
  tests: {
    registerController(id: string, controller: {
      label: string;
      supportsCoverage?: boolean;
      discover(ctx: ModuleContext): TestItem[] | Promise<TestItem[]>;
      run(ctx: ModuleContext & {
        ids: string[] | null;
        signal: AbortSignal;
        coverage: boolean;
        report(result: TestResult): void;
        output(text: string): void;
        reportCoverage(files: FileCoverage[]): void;
      }): void | Promise<void>;
      debug?(ctx: ModuleContext & { ids: string[] | null }): TestDebugLaunch | Promise<TestDebugLaunch>;
    }): void;
  };
}

interface LoadedModule {
  id: string;
  dir: string;
  main?: string;
  settings: SettingValues;
  storageDir: string;
  events?: string[];
  provides: string[];
  languages?: string[];
}

type Fn = (...args: any[]) => any;

class ExtensionHost {
  private readonly rpc = new Rpc((message) => process.parentPort.postMessage(message));
  private readonly commands = new Map<string, Fn>();
  private readonly trees = new Map<string, TreeProvider>();
  private readonly previews = new Map<string, Fn>();
  private readonly templates = new Map<string, { fileName?: Fn; content?: Fn }>();
  private readonly projectHandlers = new Map<string, Fn>();
  private readonly runProviders = new Map<string, Fn>();
  private readonly settings = new Map<string, SettingValues>();
  /** Event listeners by event name, each tagged with its module for error messages. */
  private readonly listeners = new Map<string, { moduleId: string; fn: Fn }[]>();
  private readonly deactivators: { moduleId: string; fn: Fn }[] = [];
  private readonly pending = new Map<string, LoadedModule>();
  private readonly testRuns = new Map<string, AbortController>();
  private readonly versionProviders = new Map<string, Parameters<SaturnModuleApi['languages']['registerVersions']>[1]>();
  private readonly testControllers = new Map<string, { moduleId: string; controller: Parameters<SaturnModuleApi['tests']['registerController']>[1] }>();
  private readonly activating = new Map<string, Promise<void>>();
  private readonly openProjects = new Set<string>();
  private readonly webviews = new Map<string, { html: Fn; onMessage?: Fn }>();
  private readonly docComments = new Map<string, Fn>();
  /** Per project: its open files and the focused editor's file and selection, as its window reports them. */
  private readonly editors = new Map<string, { files: Map<string, EditorFile>; activePath: string | null; selection: EditorSelection | null }>();

  private editorState(projectPath: string) {
    let state = this.editors.get(projectPath);
    if (!state) this.editors.set(projectPath, (state = { files: new Map(), activePath: null, selection: null }));
    return state;
  }

  private activeFile(projectPath: string): (EditorFile & { selection: EditorSelection | null }) | null {
    const state = this.editors.get(projectPath);
    const file = state?.activePath ? state.files.get(state.activePath) : undefined;
    return file ? { ...file, selection: state!.selection } : null;
  }

  private editorEvent(projectPath: string, event: EditorEvent): void {
    const state = this.editorState(projectPath);
    if (event.type === 'file') {
      if (event.file.languageId) void this.activateWhere((m) => m.events?.includes(`onLanguage:${event.file.languageId}`) ?? false);
      state.files.set(event.file.path, event.file);
      this.emit('editorFile', { projectPath, file: event.file });
    } else if (event.type === 'closed') {
      state.files.delete(event.path);
      this.emit('editorClosed', { projectPath, path: event.path });
    } else {
      const changedFile = event.path !== state.activePath;
      state.activePath = event.path;
      state.selection = event.selection;
      if (changedFile) this.emit('editorActive', { projectPath, file: this.activeFile(projectPath) });
      else if (event.path && event.selection) this.emit('editorSelection', { projectPath, path: event.path, selection: event.selection });
    }
  }

  start(): void {
    process.parentPort.on('message', (e) => this.rpc.receive(e.data));
    this.rpc.handle('activate', (modules: LoadedModule[]) => this.activateAll(modules));
    this.rpc.handle('deactivate', () => this.deactivateAll());
    this.rpc.handle('settingsChanged', (moduleId: string, values: SettingValues) => {
      this.settings.set(moduleId, values);
      this.emit(`settings:${moduleId}`, values);
    });
    this.rpc.handle('filesChanged', (projectPath: string, dir: string) => this.emit('filesChanged', { projectPath, dir }));
    this.rpc.handle('projectClosed', (projectPath: string) => {
      this.openProjects.delete(projectPath);
      this.editors.delete(projectPath);
      this.emit('projectClosed', { projectPath });
    });
    this.rpc.handle('editorEvent', (projectPath: string, event: EditorEvent) => this.editorEvent(projectPath, event));
    this.rpc.handle('webviewHtml', async (id: string, ctx: ModuleContext) => (await this.need(this.webviews, id, 'webview')).html(ctx));
    this.rpc.handle('webviewMessage', async (id: string, message: unknown, ctx: ModuleContext) => (await this.need(this.webviews, id, 'webview')).onMessage?.(message, ctx));
    this.rpc.handle('projectOpened', (projectPath: string) => this.projectOpened(projectPath));
    this.rpc.handle('runCommand', async (id: string, ctx: ModuleContext) => (await this.need(this.commands, id, 'command'))(ctx));
    this.rpc.handle('treeChildren', async (id: string, parentId: string | null, ctx: ModuleContext) =>
      (await this.need(this.trees, id, 'panel')).getChildren(parentId, ctx));
    this.rpc.handle('treeAction', async (id: string, actionId: string, item: TreeItem, ctx: ModuleContext) =>
      (await this.need(this.trees, id, 'panel')).onAction?.(actionId, item, ctx));
    this.rpc.handle('renderPreview', async (id: string, text: string, ctx: ModuleContext & { path: string }) =>
      (await this.need(this.previews, id, 'preview'))(text, ctx));
    this.rpc.handle('symbolRenamed', async (event: SymbolRename, ctx: ModuleContext) => {
      await this.activateWhere((m) => m.events?.includes(`onLanguage:${event.languageId}`) ?? false);
      this.emit('symbolRenamed', { ...event, ...ctx });
    });
    this.rpc.handle('docComment', async (languageId: string, request: DocCommentRequest, ctx: ModuleContext) => {
      if (!this.docComments.has(languageId)) await this.activateWhere((m) => m.events?.includes(`onLanguage:${languageId}`) ?? false);
      return (await this.docComments.get(languageId)?.({ ...request, ...ctx })) ?? null;
    });
    this.rpc.handle('templateFile', async (id: string, ctx: TemplateContext) => {
      await this.activateWhere((m) => m.provides.includes(id));
      const t = this.templates.get(id);
      return { fileName: t?.fileName?.(ctx) ?? null, content: (await t?.content?.(ctx)) ?? '' };
    });
    this.rpc.handle('createProject', async (moduleId: string, ctx: ModuleContext & { fields: Record<string, string | boolean>; createId: string }) => {
      const { createId, ...rest } = ctx;
      await this.activateWhere((m) => m.id === moduleId);
      return this.projectHandlers.get(moduleId)?.({ ...rest, progress: (message: string) => this.rpc.notify('createProgress', createId, String(message)) });
    });
    this.rpc.handle('testsDiscover', async (ctx: ModuleContext) => {
      await this.activateWhere((m) => m.provides.includes(TESTS_PROVIDER));
      const groups: TestGroup[] = [];
      for (const [controllerId, { moduleId, controller }] of this.testControllers) {
        try {
          groups.push({ controllerId, moduleId, label: controller.label, items: await controller.discover(ctx), canDebug: typeof controller.debug === 'function', canCover: !!controller.supportsCoverage });
        } catch (e) {
          groups.push({ controllerId, moduleId, label: controller.label, items: [], error: e instanceof Error ? e.message : String(e) });
        }
      }
      return groups;
    });
    this.rpc.handle('testsRun', (controllerId: string, ids: string[] | null, runId: string, ctx: ModuleContext, coverage = false) => {
      const found = this.testControllers.get(controllerId);
      if (!found) throw new Error(`No test controller ${controllerId}`);
      const abort = new AbortController();
      this.testRuns.set(runId, abort);
      const send = (event: TestEvent) => {
        if (!abort.signal.aborted || event.kind === 'done') this.rpc.notify('testEvent', ctx.projectPath, event);
      };
      const finish = (error?: string) => {
        if (!this.testRuns.delete(runId)) return;
        send({ runId, kind: 'done', controllerId, error });
      };
      abort.signal.addEventListener('abort', () => finish('Stopped'));
      void (async () => {
        try {
          await found.controller.run({
            ...ctx,
            ids,
            signal: abort.signal,
            coverage: coverage && !!found.controller.supportsCoverage,
            reportCoverage: (files) => send({ runId, kind: 'coverage', controllerId, files }),
            report: (result) => send({ runId, kind: 'result', controllerId, result }),
            output: (text) => send({ runId, kind: 'output', controllerId, text: String(text) }),
          });
          finish();
        } catch (e) {
          finish(abort.signal.aborted ? 'Stopped' : e instanceof Error ? e.message : String(e));
        }
      })();
    });
    const versions = async (languageId: string) => {
      await this.activateWhere((m) => m.provides.includes(versionsProvider(languageId)));
      const provider = this.versionProviders.get(languageId);
      if (!provider) throw new Error(`No versions are offered for ${languageId}`);
      return provider;
    };
    this.rpc.handle('versionsList', async (languageId: string, ctx: ModuleContext) => {
      const provider = await versions(languageId);
      return { items: await provider.list(ctx), addLabel: provider.add ? provider.addLabel ?? 'Add…' : undefined };
    });
    this.rpc.handle('versionsAdd', async (languageId: string, folder: string, ctx: ModuleContext) => {
      const provider = await versions(languageId);
      if (!provider.add) throw new Error(`Versions can't be added for ${languageId}`);
      return provider.add({ ...ctx, folder });
    });
    this.rpc.handle('versionsChanged', async (languageId: string, version: LanguageVersion, ctx: ModuleContext) => {
      await (await versions(languageId)).onChange?.({ ...ctx, version });
    });
    this.rpc.handle('testsCancel', (runId: string) => this.testRuns.get(runId)?.abort());
    this.rpc.handle('testsDebug', async (controllerId: string, ids: string[] | null, ctx: ModuleContext) => {
      const found = this.testControllers.get(controllerId);
      if (!found?.controller.debug) throw new Error(`${found?.controller.label ?? 'These tests'} can't be debugged`);
      return found.controller.debug({ ...ctx, ids });
    });
    this.rpc.handle('runEntries', async (ctx: ModuleContext) => {
      await this.activateWhere((m) => m.provides.includes(RUN_PROVIDER));
      const all: { moduleId: string; name: string; command: string }[] = [];
      for (const [moduleId, provide] of this.runProviders) {
        try {
          all.push(...((await provide(ctx)) as { name: string; command: string }[]).map((e) => ({ ...e, moduleId })));
        } catch (e) {
          console.error(`[${moduleId}] run provider failed`, e);
        }
      }
      return all;
    });
  }

  private async activateAll(modules: LoadedModule[]): Promise<{ id: string; error: string }[]> {
    const failures: { id: string; error: string }[] = [];
    for (const m of modules) {
      this.settings.set(m.id, m.settings);
      if (!m.main) continue;
      if (m.events && !m.events.includes('*') && (m.languages ?? []).every((id) => m.events!.includes(`onLanguage:${id}`))) {
        this.pending.set(m.id, m);
        continue;
      }
      const error = await this.load(m);
      if (error) failures.push({ id: m.id, error });
    }
    return failures;
  }

  private async load(m: LoadedModule): Promise<string | null> {
    try {
      await mkdir(m.storageDir, { recursive: true });
      const mod = await import(/* @vite-ignore */ pathToFileURL(join(m.dir, m.main!)).href);
      await mod.activate?.(this.apiFor(m.id, m.storageDir));
      if (typeof mod.deactivate === 'function') this.deactivators.push({ moduleId: m.id, fn: mod.deactivate });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  private activate(m: LoadedModule): Promise<void> {
    let running = this.activating.get(m.id);
    if (!running) {
      this.pending.delete(m.id);
      running = this.load(m).then((error) => {
        if (error) console.error(`[${m.id}] failed to activate: ${error}`);
        for (const projectPath of this.openProjects) this.emit('projectOpened', { projectPath }, m.id);
      });
      this.activating.set(m.id, running);
    }
    return running;
  }

  private async activateWhere(matches: (m: LoadedModule) => boolean): Promise<void> {
    await Promise.all([...this.pending.values()].filter(matches).map((m) => this.activate(m)));
    await Promise.all(this.activating.values());
  }

  private async projectOpened(projectPath: string): Promise<void> {
    this.emit('projectOpened', { projectPath });
    this.openProjects.add(projectPath);
    for (const m of [...this.pending.values()]) {
      const globs = (m.events ?? []).filter((e) => e.startsWith('workspaceContains:')).map((e) => e.slice('workspaceContains:'.length));
      for (const glob of globs) {
        if ((await findFiles(projectPath, glob, 1)).length > 0) {
          await this.activate(m);
          break;
        }
      }
    }
  }

  /** Runs every module's `deactivate()` before the host stops; one failing doesn't stop the rest. */
  private async deactivateAll(): Promise<void> {
    for (const { moduleId, fn } of this.deactivators) {
      try {
        await fn();
      } catch (e) {
        console.error(`[${moduleId}] deactivate failed`, e);
      }
    }
  }

  private on(event: string, moduleId: string, fn: Fn): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), { moduleId, fn }]);
  }

  private emit(event: string, payload: unknown, onlyModule?: string): void {
    for (const { moduleId, fn } of this.listeners.get(event) ?? []) {
      if (onlyModule && moduleId !== onlyModule) continue;
      try {
        void Promise.resolve(fn(payload)).catch((e) => console.error(`[${moduleId}] ${event} listener failed`, e));
      } catch (e) {
        console.error(`[${moduleId}] ${event} listener failed`, e);
      }
    }
  }

  private apiFor(moduleId: string, storagePath: string): SaturnModuleApi {
    return {
      platform: process.platform,
      storagePath,
      commands: { register: (id, run) => void this.commands.set(id, run) },
      panels: {
        registerTree: (id, provider) => void this.trees.set(id, provider),
        refresh: (id, itemId) => this.rpc.notify('refreshPanel', id, itemId),
      },
      previews: { registerRenderer: (id, render) => void this.previews.set(id, render) },
      files: { registerTemplate: (id, template) => void this.templates.set(id, template) },
      projects: {
        onCreate: (handler) => void this.projectHandlers.set(moduleId, handler),
        onDidClose: (listener) => this.on('projectClosed', moduleId, listener),
        onDidOpen: (listener) => this.on('projectOpened', moduleId, listener),
      },
      run: { registerProvider: (provide) => void this.runProviders.set(moduleId, provide) },
      workspace: {
        findFiles: (projectPath, glob) => findFiles(projectPath, glob),
        openFile: (projectPath, path, line, column) => this.rpc.notify('openFile', projectPath, path, line, column),
        onDidChangeFiles: (listener) => this.on('filesChanged', moduleId, listener),
        renameFile: (projectPath, path, newName) => this.rpc.call<string>('renameFile', projectPath, path, newName),
      },
      window: {
        showMessage: (message, options) => this.rpc.notify('showMessage', { message, kind: options?.kind ?? 'info', projectPath: options?.projectPath, moduleId }),
        notify: (n) => this.rpc.notify('notify', { ...n, moduleId }),
        showInput: (projectPath, options) => this.rpc.call<string | null>('showInput', projectPath, options),
      },
      languageServer: {
        restart: () => this.rpc.notify('restartLanguageServer', moduleId),
      },
      languages: {
        registerVersions: (languageId, provider) => void this.versionProviders.set(languageId, provider),
        getVersion: (projectPath, languageId) => this.rpc.call<LanguageVersion | null>('languageVersion', projectPath, languageId),
        onDidRenameSymbol: (listener) => this.on('symbolRenamed', moduleId, listener),
        registerDocComment: (languageId, provide) => void this.docComments.set(languageId, provide),
      },
      terminal: {
        run: (projectPath, options) => this.rpc.notify('runInTerminal', projectPath, options.name, options.command),
      },
      settings: {
        get: (id) => this.settings.get(moduleId)?.[id],
        onChange: (listener) => this.on(`settings:${moduleId}`, moduleId, listener),
      },
      editor: {
        activeFile: (projectPath) => this.activeFile(projectPath),
        openFiles: (projectPath) => [...(this.editors.get(projectPath)?.files.values() ?? [])],
        file: (projectPath, path) => this.editors.get(projectPath)?.files.get(path) ?? null,
        onDidChangeActive: (listener) => this.on('editorActive', moduleId, listener),
        onDidChangeSelection: (listener) => this.on('editorSelection', moduleId, listener),
        onDidChangeFile: (listener) => this.on('editorFile', moduleId, listener),
        onDidCloseFile: (listener) => this.on('editorClosed', moduleId, listener),
      },
      tests: {
        registerController: (id, controller) => void this.testControllers.set(id, { moduleId, controller }),
      },
      webviews: {
        register: (panelId, provider) => void this.webviews.set(panelId, provider),
        postMessage: (panelId, message, projectPath) => this.rpc.notify('webviewPost', panelId, projectPath ?? null, message),
        refresh: (panelId) => this.rpc.notify('webviewRefresh', panelId),
      },
    };
  }

  private async need<T>(map: Map<string, T>, id: string, what: string): Promise<T> {
    if (!map.has(id)) await this.activateWhere((m) => m.provides.includes(id) || (m.events?.includes(`onCommand:${id}`) ?? false));
    const found = map.get(id);
    if (!found) throw new Error(`No ${what} handler registered for ${id}`);
    return found;
  }
}

new ExtensionHost().start();
