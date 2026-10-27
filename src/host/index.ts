/**
 * The extension host: a separate process that loads enabled modules and runs their code, so a slow
 * or crashing module can never freeze the editor. Main talks to it over an Rpc channel.
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { MessageKind, NotificationAction, SettingValue, SettingValues, TreeItem } from '@shared/modules';
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
    onCreate(handler: (ctx: ModuleContext & { fields: Record<string, string | boolean> }) => void | Promise<void>): void;
    /** A project's editor window closed; release anything held for it (watchers, caches). */
    onDidClose(listener: (ctx: ModuleContext) => void): void;
  };
  run: { registerProvider(provide: (ctx: ModuleContext) => { name: string; command: string }[] | Promise<{ name: string; command: string }[]>): void };
  workspace: {
    findFiles(projectPath: string, glob: string): Promise<string[]>;
    /** Opens a file in that project's editor window, at a 1-based line and column. */
    openFile(projectPath: string, path: string, line?: number, column?: number): void;
    /** Files changed inside an open project: `dir` is the folder whose contents changed (debounced). */
    onDidChangeFiles(listener: (e: { projectPath: string; dir: string }) => void): void;
  };
  window: {
    /** Shows a message in the status bar: of that project's window if given, otherwise every window. */
    showMessage(message: string, options?: { kind?: MessageKind; projectPath?: string }): void;
    /**
     * Adds a notification to the bell menu next to Settings. Actions can run one of this module's
     * commands, open its Settings tab, or open an https link.
     */
    notify(notification: { title: string; message?: string; kind?: MessageKind; actions?: NotificationAction[] }): void;
  };
  languageServer: {
    /** Restarts this module's language server (and re-checks `requires`), e.g. after installing it. */
    restart(): void;
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
}

interface LoadedModule {
  id: string;
  dir: string;
  main?: string;
  settings: SettingValues;
  storageDir: string;
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

  start(): void {
    process.parentPort.on('message', (e) => this.rpc.receive(e.data));
    this.rpc.handle('activate', (modules: LoadedModule[]) => this.activateAll(modules));
    this.rpc.handle('deactivate', () => this.deactivateAll());
    this.rpc.handle('settingsChanged', (moduleId: string, values: SettingValues) => {
      this.settings.set(moduleId, values);
      this.emit(`settings:${moduleId}`, values);
    });
    this.rpc.handle('filesChanged', (projectPath: string, dir: string) => this.emit('filesChanged', { projectPath, dir }));
    this.rpc.handle('projectClosed', (projectPath: string) => this.emit('projectClosed', { projectPath }));
    this.rpc.handle('runCommand', (id: string, ctx: ModuleContext) => this.need(this.commands, id, 'command')(ctx));
    this.rpc.handle('treeChildren', (id: string, parentId: string | null, ctx: ModuleContext) =>
      this.need(this.trees, id, 'panel').getChildren(parentId, ctx));
    this.rpc.handle('treeAction', (id: string, actionId: string, item: TreeItem, ctx: ModuleContext) =>
      this.need(this.trees, id, 'panel').onAction?.(actionId, item, ctx));
    this.rpc.handle('renderPreview', (id: string, text: string, ctx: ModuleContext & { path: string }) =>
      this.need(this.previews, id, 'preview')(text, ctx));
    this.rpc.handle('templateFile', async (id: string, ctx: TemplateContext) => {
      const t = this.templates.get(id);
      return { fileName: t?.fileName?.(ctx) ?? null, content: (await t?.content?.(ctx)) ?? '' };
    });
    this.rpc.handle('createProject', (moduleId: string, ctx: ModuleContext & { fields: Record<string, string | boolean> }) =>
      this.projectHandlers.get(moduleId)?.(ctx));
    this.rpc.handle('runEntries', async (ctx: ModuleContext) => {
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
      try {
        await mkdir(m.storageDir, { recursive: true });
        const mod = await import(/* @vite-ignore */ pathToFileURL(join(m.dir, m.main)).href);
        await mod.activate?.(this.apiFor(m.id, m.storageDir));
        if (typeof mod.deactivate === 'function') this.deactivators.push({ moduleId: m.id, fn: mod.deactivate });
      } catch (e) {
        failures.push({ id: m.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return failures;
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

  private emit(event: string, payload: unknown): void {
    for (const { moduleId, fn } of this.listeners.get(event) ?? []) {
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
      },
      run: { registerProvider: (provide) => void this.runProviders.set(moduleId, provide) },
      workspace: {
        findFiles: (projectPath, glob) => findFiles(projectPath, glob),
        openFile: (projectPath, path, line, column) => this.rpc.notify('openFile', projectPath, path, line, column),
        onDidChangeFiles: (listener) => this.on('filesChanged', moduleId, listener),
      },
      window: {
        showMessage: (message, options) => this.rpc.notify('showMessage', { message, kind: options?.kind ?? 'info', projectPath: options?.projectPath, moduleId }),
        notify: (n) => this.rpc.notify('notify', { ...n, moduleId }),
      },
      languageServer: {
        restart: () => this.rpc.notify('restartLanguageServer', moduleId),
      },
      terminal: {
        run: (projectPath, options) => this.rpc.notify('runInTerminal', projectPath, options.name, options.command),
      },
      settings: {
        get: (id) => this.settings.get(moduleId)?.[id],
        onChange: (listener) => this.on(`settings:${moduleId}`, moduleId, listener),
      },
    };
  }

  private need<T>(map: Map<string, T>, id: string, what: string): T {
    const found = map.get(id);
    if (!found) throw new Error(`No ${what} handler registered for ${id}`);
    return found;
  }
}

new ExtensionHost().start();
