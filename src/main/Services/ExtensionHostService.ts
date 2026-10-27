import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { MessageKind, ModuleMessage, NotificationAction, SettingValues, TreeItem } from '@shared/modules';
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
    const loadable = modules.map((m) => ({ id: m.manifest.id, dir: m.dir, main: m.manifest.main, settings: m.settings, storageDir: m.storageDir }));
    await rpc.call<{ id: string; error: string }[]>('activate', loadable).then(
      (failures) => failures.forEach((f) => console.error(`Module ${f.id} failed to activate: ${f.error}`)),
      (e) => console.error('Extension host failed to activate modules', e),
    );
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
    void this.ready.then(() => this.rpc?.notify('projectClosed', projectPath));
  }

  treeAction(panelId: string, actionId: string, item: TreeItem, ctx: Ctx): Promise<void> {
    return this.call('treeAction', panelId, actionId, item, ctx);
  }

  runCommand(id: string, ctx: Ctx): Promise<void> {
    return this.call('runCommand', id, ctx);
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

  runEntries(ctx: Ctx): Promise<{ moduleId: string; name: string; command: string }[]> {
    return this.call('runEntries', ctx);
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.ready;
    if (!this.rpc) throw new Error('The extension host is not running');
    return this.rpc.call<T>(method, ...args);
  }
}
