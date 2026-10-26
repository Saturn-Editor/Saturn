import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { channel } from '@shared/api';
import type { CompletionRequest } from '@shared/modules';
import type { LayoutState, NewProjectRequest, RunEntry } from '@shared/types';
import type { ExtensionHostService } from '../Services/ExtensionHostService';
import { FileService } from '../Services/FileService';
import type { LanguageServerService } from '../Services/LanguageServerService';
import type { ModuleService } from '../Services/ModuleService';
import type { ProjectCreator } from '../Services/ProjectCreator';
import type { TerminalService } from '../Services/TerminalService';
import type { ThemeService } from '../Services/ThemeService';
import type { LayoutStore } from '../Store/LayoutStore';
import type { RecentProjectsStore } from '../Store/RecentProjectsStore';
import type { RunConfigStore } from '../Store/RunConfigStore';
import type { WindowManager } from '../Windows/WindowManager';

export interface SaturnServices {
  windows: WindowManager;
  themes: ThemeService;
  recent: RecentProjectsStore;
  creator: ProjectCreator;
  layouts: LayoutStore;
  terminals: TerminalService;
  runs: RunConfigStore;
  modules: ModuleService;
  host: ExtensionHostService;
  languageServers: LanguageServerService;
}

type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;
type Listener = (event: IpcMainEvent, ...args: any[]) => void;

/** Registers every IPC handler. Each area registers its handlers in its own method. */
export class IpcRouter {
  private readonly files = new Map<number, { service: FileService; stopWatching: () => void }>();

  constructor(private readonly services: SaturnServices) {}

  register(): void {
    this.registerWindows();
    this.registerProjects();
    this.registerThemes();
    this.registerFiles();
    this.registerLayout();
    this.registerTerminals();
    this.registerRun();
    this.registerModules();
  }

  /** Sends an event to every open window. */
  broadcast(area: string, name: string, ...args: unknown[]): void {
    for (const win of this.services.windows.all()) this.send(win.webContents, area, name, ...args);
  }

  /** Sends an event to the editor window showing `projectPath`, if it's open. */
  sendToProject(projectPath: string, area: string, name: string, ...args: unknown[]): void {
    const win = this.services.windows.editorFor(projectPath);
    if (win) this.send(win.webContents, area, name, ...args);
  }

  private registerModules(): void {
    const { modules, host, languageServers, windows } = this.services;
    const ctx = (e: IpcMainInvokeEvent) => ({ projectPath: this.projectOf(e) });

    this.handle('modules', 'list', () => modules.summaries());
    this.handle('modules', 'snapshot', () => modules.snapshot());
    this.handle('modules', 'grammar', (_e, languageId: string) => modules.grammar(languageId));
    this.handle('modules', 'installDialog', async (e) => {
      const result = await dialog.showOpenDialog(this.senderWindow(e), {
        title: 'Install a language from a folder',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const manifest = await modules.install(result.filePaths[0]);
      return (await modules.summaries()).find((m) => m.id === manifest.id) ?? null;
    });
    this.handle('modules', 'uninstall', (_e, id: string) => modules.uninstall(id));
    this.handle('modules', 'setEnabled', (_e, id: string, enabled: boolean) => modules.setEnabled(id, enabled));
    this.handle('modules', 'runCommand', (e, id: string) => host.runCommand(id, ctx(e)));
    this.handle('modules', 'treeChildren', (e, panelId: string, parentId: string | null) => host.treeChildren(panelId, parentId, ctx(e)));
    this.handle('modules', 'renderPreview', (e, id: string, text: string, path: string) => host.renderPreview(id, text, { ...ctx(e), path }));
    this.handle('modules', 'templateFile', (e, id: string, name: string, dir: string) => host.templateFile(id, { ...ctx(e), name, dir }));
    this.handle('modules', 'complete', (e, req: CompletionRequest) => languageServers.complete(this.projectOf(e), req));

    this.on('windows', 'openMarketplace', (e, section?: string) => windows.openMarketplace(this.senderWindow(e), section));
  }

  private handle(area: string, name: string, fn: Handler): void {
    ipcMain.handle(channel(area, name), fn);
  }

  private on(area: string, name: string, fn: Listener): void {
    ipcMain.on(channel(area, name), fn);
  }

  private senderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('IPC call from an unknown window');
    return win;
  }

  private projectOf(event: IpcMainEvent | IpcMainInvokeEvent): string {
    const path = this.services.windows.projectOf(this.senderWindow(event));
    if (!path) throw new Error('This window has no project');
    return path;
  }

  private send(target: WebContents, area: string, name: string, ...args: unknown[]): void {
    if (!target.isDestroyed()) target.send(channel(area, name), ...args);
  }

  private registerWindows(): void {
    const { windows } = this.services;
    this.on('windows', 'openSettings', (e, section?: string) => windows.openSettings(this.senderWindow(e), section));
    this.on('windows', 'openNewProject', (e) => windows.openNewProject(this.senderWindow(e)));
    this.on('window', 'close', (e) => this.senderWindow(e).close());
    this.on('window', 'setDirty', (e, dirty: boolean) => windows.setDirty(this.senderWindow(e), dirty));
  }

  private registerProjects(): void {
    const { windows, recent, creator, modules, host } = this.services;
    /** Projects created with a language remember it; others are detected from their files. */
    const openProject = async (path: string, languageId?: string | null) => {
      const known = (await recent.list()).find((p) => p.path === path)?.languageId;
      await recent.touch(path, languageId ?? known ?? (await modules.detectLanguage(path)));
      windows.openEditor(path);
    };

    this.handle('projects', 'recent', () => recent.list());
    this.handle('projects', 'removeRecent', (_e, path: string) => recent.remove(path));
    this.handle('projects', 'openPath', async (_e, path: string) => {
      const exists = await stat(path).then((s) => s.isDirectory(), () => false);
      if (!exists) return 'missing';
      await openProject(path);
      return 'opened';
    });
    this.handle('projects', 'openDialog', async (e) => {
      const result = await dialog.showOpenDialog(this.senderWindow(e), { properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled && result.filePaths[0]) await openProject(result.filePaths[0]);
    });
    this.handle('projects', 'pickFolder', async (e) => {
      const result = await dialog.showOpenDialog(this.senderWindow(e), { properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    this.handle('projects', 'create', async (e, req: NewProjectRequest) => {
      const sender = this.senderWindow(e);
      const path = await creator.create(req);
      if (req.languageId) {
        const owner = (await modules.snapshot()).newProject.find((n) => n.language === req.languageId);
        if (owner) await host.createProject(owner.moduleId, { projectPath: path, fields: req.fields });
      }
      await openProject(path, req.languageId);
      sender.close();
    });
    this.handle('projects', 'defaultParentDir', async () => {
      const dev = join(homedir(), 'development');
      return (await stat(dev).then((s) => s.isDirectory(), () => false)) ? dev : homedir();
    });
  }

  private registerThemes(): void {
    const { themes } = this.services;
    this.handle('themes', 'list', () => themes.list());
    this.handle('themes', 'active', () => themes.active());
    this.handle('themes', 'setActive', async (_e, id: string) => {
      this.broadcast('themes', 'changed', await themes.setActive(id));
    });
    this.handle('themes', 'installDialog', async (e) => {
      const result = await dialog.showOpenDialog(this.senderWindow(e), {
        title: 'Install a theme from a folder',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const installed = await themes.install(result.filePaths[0]);
      this.broadcast('themes', 'listChanged');
      return installed;
    });
    this.handle('themes', 'uninstall', async (_e, id: string) => {
      const fallback = await themes.uninstall(id);
      if (fallback) this.broadcast('themes', 'changed', fallback);
      this.broadcast('themes', 'listChanged');
    });
  }

  /** One FileService per editor window, rooted at that window's project. */
  private filesFor(event: IpcMainInvokeEvent): FileService {
    const sender = event.sender;
    const existing = this.files.get(sender.id);
    if (existing) return existing.service;
    const service = new FileService(this.projectOf(event));
    const stopWatching = service.watch((dir) => this.send(sender, 'fs', 'changed', dir));
    this.files.set(sender.id, { service, stopWatching });
    sender.once('destroyed', () => {
      this.files.get(sender.id)?.stopWatching();
      this.files.delete(sender.id);
    });
    return service;
  }

  private registerFiles(): void {
    this.handle('fs', 'readDir', (e, path: string) => this.filesFor(e).readDir(path));
    this.handle('fs', 'readFile', (e, path: string, opts?: { force?: boolean }) => this.filesFor(e).readFile(path, opts));
    this.handle('fs', 'writeFile', (e, path: string, text: string) => this.filesFor(e).writeFile(path, text));
    this.handle('fs', 'createFile', (e, path: string, text?: string) => this.filesFor(e).createFile(path, text));
    this.handle('fs', 'createDir', (e, path: string) => this.filesFor(e).createDir(path));
  }

  private registerLayout(): void {
    const { layouts } = this.services;
    this.handle('layout', 'load', (e) => layouts.load(this.projectOf(e)));
    this.handle('layout', 'save', (e, state: LayoutState) => layouts.save(this.projectOf(e), state));
  }

  private registerTerminals(): void {
    const { terminals } = this.services;
    const owners = new Map<number, WebContents>();
    terminals.onData((owner, id, data) => {
      const target = owners.get(owner);
      if (target) this.send(target, 'terminal', 'data', id, data);
    });
    terminals.onExit((owner, id, code) => {
      const target = owners.get(owner);
      if (target) this.send(target, 'terminal', 'exit', id, code);
    });

    this.handle('terminal', 'create', (e, opts: { cwd: string; name: string; command?: string }) => {
      const sender = e.sender;
      if (!owners.has(sender.id)) {
        owners.set(sender.id, sender);
        sender.once('destroyed', () => {
          terminals.killAllFor(sender.id);
          owners.delete(sender.id);
        });
      }
      return terminals.create(opts, sender.id);
    });
    this.on('terminal', 'write', (_e, id: string, data: string) => terminals.write(id, data));
    this.on('terminal', 'resize', (_e, id: string, cols: number, rows: number) => terminals.resize(id, cols, rows));
    this.on('terminal', 'kill', (_e, id: string) => terminals.kill(id));
  }

  private registerRun(): void {
    const { runs, host, modules } = this.services;
    /** Language-suggested entries first (grouped by language), then the user's custom commands. */
    this.handle('run', 'list', async (e) => {
      const projectPath = this.projectOf(e);
      const names = new Map((await modules.list()).map((m) => [m.manifest.id, m.manifest.name]));
      const suggested = await host.runEntries({ projectPath }).catch(() => []);
      const fromModules: RunEntry[] = suggested.map((s) => ({
        id: `${s.moduleId}:${s.name}`,
        name: s.name,
        command: s.command,
        source: s.moduleId,
        group: names.get(s.moduleId) ?? s.moduleId,
      }));
      return [...fromModules, ...(await runs.list(projectPath))];
    });
    this.handle('run', 'addCustom', (e, input: { name: string; command: string }) => runs.addCustom(this.projectOf(e), input));
    this.handle('run', 'removeCustom', (e, id: string) => runs.removeCustom(this.projectOf(e), id));
    this.handle('run', 'selected', (e) => runs.selected(this.projectOf(e)));
    this.handle('run', 'select', (e, id: string) => runs.select(this.projectOf(e), id));
  }
}
