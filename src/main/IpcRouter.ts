import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { channel } from '@shared/api';
import type { MarketplaceKind } from '@shared/marketplace';
import { MANIFEST_FILES, SATURN_API_VERSION, type CodeActionRequest, type CompletionRequest, type DocCommentRequest, type DocumentRequest, type EditorEvent, type SymbolRename, type LanguageVersion, type SettingValue, type TestSet, type TreeItem } from '@shared/modules';
import type { AppFolder, AppInfo, AppSettings, Breakpoint, LayoutState, NewProjectRequest, RebaseStep, RunEntry, ThemeMode } from '@shared/types';
import type { AppPaths } from './Helpers/AppPaths';
import type { ExtensionHostService } from './Services/ExtensionHostService';
import { FileService } from './Services/FileService';
import { GitService } from './Services/GitService';
import type { LanguageServerService } from './Services/LanguageServerService';
import { withLocalZip, type MarketplaceService } from './Services/MarketplaceService';
import { visibleIn, type NotificationService } from './Services/NotificationService';
import type { UpdateService } from './Services/UpdateService';
import type { DebugService } from './Services/DebugService';
import type { AskpassService } from './Services/AskpassService';
import type { TrashService } from './Services/TrashService';
import type { LanguageVersionStore } from './Store/LanguageVersionStore';
import type { CodeModuleService } from './Services/CodeModuleService';
import type { ProjectCreator } from './Services/ProjectCreator';
import type { TerminalService } from './Services/TerminalService';
import type { ThemeService } from './Services/ThemeService';
import type { LayoutStore } from './Store/LayoutStore';
import type { RecentProjectsStore } from './Store/RecentProjectsStore';
import type { RunConfigStore } from './Store/RunConfigStore';
import type { TestSetStore } from './Store/TestSetStore';
import type { SettingsStore } from './Store/SettingsStore';
import type { WindowManager } from './WindowManager';

export interface SaturnServices {
  windows: WindowManager;
  themes: ThemeService;
  recent: RecentProjectsStore;
  creator: ProjectCreator;
  layouts: LayoutStore;
  terminals: TerminalService;
  runs: RunConfigStore;
  testSets: TestSetStore;
  modules: CodeModuleService;
  host: ExtensionHostService;
  languageServers: LanguageServerService;
  marketplace: MarketplaceService;
  settings: SettingsStore;
  paths: AppPaths;
  notifications: NotificationService;
  updates: UpdateService;
  debug: DebugService;
  askpass: AskpassService;
  trash: TrashService;
  languageVersions: LanguageVersionStore;
  /** Wipes Saturn's data and starts over as on a first launch (Settings → Reset Saturn, after confirming). */
  reset: () => Promise<void>;
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
    this.registerMarketplace();
    this.registerSettings();
    this.registerApp();
    this.registerGit();
    this.registerNotifications();
    this.registerUpdates();
    this.registerDebug();
  }

  private registerDebug(): void {
    const { debug } = this.services;
    this.handle('debug', 'state', (e) => debug.state(this.projectOf(e)));
    this.handle('debug', 'breakpoints', (e) => debug.breakpointsFor(this.projectOf(e)));
    this.handle('debug', 'setBreakpoints', (e, path: string, list: Breakpoint[]) => debug.setBreakpoints(this.projectOf(e), path, list));
    this.handle('debug', 'start', (e, req: { path: string; languageId: string; configuration?: string; processId?: number }) => debug.start(this.projectOf(e), req));
    this.handle('debug', 'setWatches', (e, expressions: string[]) => debug.setWatches(this.projectOf(e), expressions));
    this.handle('debug', 'setExceptionFilters', (e, ids: string[]) => debug.setExceptionFilters(this.projectOf(e), ids));
    this.handle('debug', 'selectThread', (e, threadId: number) => debug.selectThread(this.projectOf(e), threadId));
    this.handle('debug', 'processes', () => debug.processes());
    this.handle('debug', 'stop', (e) => debug.stop(this.projectOf(e)));
    for (const action of ['continue', 'next', 'stepIn', 'stepOut', 'pause'] as const) {
      this.handle('debug', action, (e) => debug.control(this.projectOf(e), action));
    }
    this.handle('debug', 'selectFrame', (e, frameId: number) => debug.selectFrame(this.projectOf(e), frameId));
    this.handle('debug', 'variables', (e, ref: number) => debug.variables(this.projectOf(e), ref));
    this.handle('debug', 'evaluate', (e, expression: string) => debug.evaluate(this.projectOf(e), expression));
  }

  private registerUpdates(): void {
    const { updates } = this.services;
    this.handle('updates', 'status', () => updates.current());
    this.handle('updates', 'check', () => updates.check());
    this.handle('updates', 'install', () => updates.install());
  }

  private registerNotifications(): void {
    const { notifications, host, windows } = this.services;
    const windowProject = (e: IpcMainInvokeEvent) => windows.projectOf(this.senderWindow(e));
    this.handle('notifications', 'list', (e) => notifications.list().filter((n) => visibleIn(n, windowProject(e))));
    this.handle('notifications', 'dismiss', (_e, id: string) => notifications.dismiss(id));
    this.handle('notifications', 'clear', (e) => notifications.clear(windowProject(e)));
    this.handle('notifications', 'markAllRead', (e) => notifications.markAllRead(windowProject(e)));
    // Runs one of a notification's actions; commands run in the sender's project.
    this.handle('notifications', 'act', async (e, id: string, index: number) => {
      const n = notifications.get(id);
      const action = n?.actions[index];
      if (!n || !action) return;
      if (action.installUpdate && n.moduleId === 'saturn') this.services.updates.install();
      else if (action.command) await host.runCommand(action.command, { projectPath: this.projectOf(e) });
      else if (action.openSettings) windows.openSettings(this.senderWindow(e), `module:${n.moduleId}`);
      else if (action.openMarketplace) windows.openMarketplace(this.senderWindow(e), action.openMarketplace);
      else if (action.updateAll && n.moduleId === 'saturn') {
        const { marketplace } = this.services;
        await marketplace.installUpdates(await marketplace.availableUpdates());
        notifications.dismiss(id);
      }
      else if (action.url?.startsWith('https://')) await shell.openExternal(action.url);
    });
  }

  /** Git for the sender's project. Changes tell that window's Git views to refresh. */
  private registerGit(): void {
    const gitFor = (e: IpcMainInvokeEvent) => new GitService(this.projectOf(e));
    const changing = (name: string, run: (git: GitService, ...args: any[]) => Promise<void>) => {
      this.handle('git', name, async (e, ...args: unknown[]) => {
        await run(gitFor(e), ...args);
        this.send(e.sender, 'git', 'changed');
      });
    };
    this.handle('git', 'status', (e) => gitFor(e).status());
    this.handle('git', 'log', (e, ref?: string) => gitFor(e).log(200, ref));
    this.handle('git', 'fileLog', (e, path: string) => gitFor(e).log(200, undefined, path));
    this.handle('git', 'blame', (e, path: string) => gitFor(e).blame(path));
    this.handle('git', 'rebaseCommits', (e, onto: string) => gitFor(e).rebaseCommits(onto));
    this.handle('git', 'conflictVersions', (e, path: string) => gitFor(e).conflictVersions(path));
    this.handle('git', 'remoteBranches', (e) => gitFor(e).remoteBranches());
    this.handle('git', 'show', (e, hash: string) => gitFor(e).show(hash));
    this.handle('git', 'branches', (e) => gitFor(e).branches());
    changing('init', (git) => git.init());
    changing('stage', (git, paths: string[]) => git.stage(paths));
    changing('unstage', (git, paths: string[]) => git.unstage(paths));
    changing('commit', (git, message: string) => git.commit(message));
    changing('checkout', (git, branch: string, mode?: 'bring' | 'shelve') => git.checkout(branch, mode));
    changing('createBranch', (git, name: string) => git.createBranch(name));
    // Pushing can take a while, so finishing posts a notification (which also pops up).
    const pushed = async (git: GitService, what: string) => {
      const { branch } = await git.status().catch(() => ({ branch: null }));
      this.services.notifications.add({ moduleId: 'saturn', projectPath: git.root, title: what === 'tags' ? 'Tags pushed' : `Pushed ${branch ?? 'branch'}`, message: what === 'tags' ? '' : `Your commits are on ${what}.` });
    };
    changing('push', async (git) => {
      await git.push();
      await pushed(git, (await git.status()).upstream ?? 'the remote');
    });
    changing('pull', (git) => git.pull());
    this.handle('git', 'diff', (e, path: string, hash?: string) => gitFor(e).diff(path, hash));
    this.handle('git', 'stashes', (e) => gitFor(e).stashes());
    this.handle('git', 'remotes', (e) => gitFor(e).remotes());
    changing('renameBranch', (git, from: string, to: string) => git.renameBranch(from, to));
    changing('deleteBranch', (git, name: string, force?: boolean) => git.deleteBranch(name, force));
    changing('merge', (git, name: string) => git.merge(name));
    changing('abortOperation', (git) => git.abortOperation());
    changing('continueOperation', (git) => git.continueOperation());
    changing('rebase', (git, onto: string) => git.rebase(onto));
    changing('rebaseInteractive', (git, onto: string, steps: RebaseStep[]) => git.rebaseInteractive(onto, steps));
    changing('cherryPick', (git, hash: string) => git.cherryPick(hash));
    changing('revert', (git, hash: string) => git.revert(hash));
    this.handle('git', 'tags', (e) => gitFor(e).tags());
    changing('createTag', (git, name: string, hash?: string, message?: string) => git.createTag(name, hash, message));
    changing('renameTag', (git, from: string, to: string) => git.renameTag(from, to));
    changing('deleteTag', (git, name: string) => git.deleteTag(name));
    changing('pushTags', async (git) => {
      await git.pushTags();
      await pushed(git, 'tags');
    });
    this.handle('git', 'workingDiff', (e, path: string) => gitFor(e).workingDiff(path));
    changing('applyHunk', (git, patch: string, unstage: boolean) => git.applyHunk(patch, unstage));
    changing('resolveWith', (git, path: string, side: 'ours' | 'theirs') => git.resolveWith(path, side));
    changing('stash', (git, message: string) => git.stash(message));
    changing('applyStash', (git, ref: string, pop: boolean) => git.applyStash(ref, pop));
    changing('dropStash', (git, ref: string) => git.dropStash(ref));
    changing('addRemote', (git, name: string, url: string) => git.addRemote(name, url));
    changing('removeRemote', (git, name: string) => git.removeRemote(name));
    changing('pushTo', async (git, remote: string) => {
      await git.pushTo(remote);
      await pushed(git, remote);
    });
    this.handle('git', 'answerCredential', (_e, id: string, answer: string | null) => this.services.askpass.answer(id, answer));
  }

  private registerApp(): void {
    const { paths } = this.services;
    const folders: Record<AppFolder, { label: string; path: string }> = {
      install: { label: 'Installed in', path: app.getAppPath() },
      userData: { label: 'Settings and data', path: paths.root },
      languages: { label: 'Languages', path: paths.dir('languages') },
      extensions: { label: 'Extensions', path: paths.dir('extensions') },
      themes: { label: 'Themes', path: paths.dir('themes') },
    };
    const osName: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
    this.handle('app', 'info', (): AppInfo => ({
      version: app.getVersion(),
      saturnApi: SATURN_API_VERSION,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
      os: `${osName[process.platform] ?? process.platform} ${process.getSystemVersion()} (${process.arch})`,
      locale: app.getLocale(),
      folders: Object.entries(folders).map(([id, f]) => ({ id: id as AppFolder, ...f })),
    }));
    // Reset Saturn: after confirming, SaturnApp wipes Saturn's own data and starts over in place.
    // Project folders on disk are never touched.
    this.handle('app', 'reset', async (e) => {
      const { response } = await dialog.showMessageBox(this.senderWindow(e), {
        type: 'warning',
        message: 'Reset Saturn?',
        detail: 'This removes all settings, installed languages, extensions and themes, and the recent projects list, closes every window without saving, and starts Saturn over as new. Your project folders on disk are not touched.',
        buttons: ['Reset Saturn', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return false;
      await this.services.reset();
      return true;
    });
    // Only the folders listed above can be opened, never an arbitrary path from the renderer.
    this.handle('app', 'openFolder', async (_e, id: AppFolder) => {
      const folder = folders[id];
      if (!folder) throw new Error(`Unknown folder: ${id}`);
      await mkdir(folder.path, { recursive: true });
      const problem = await shell.openPath(folder.path);
      if (problem) throw new Error(problem);
    });
  }

  private registerSettings(): void {
    const { settings, marketplace } = this.services;
    this.handle('settings', 'get', () => settings.app());
    this.handle('settings', 'update', async (_e, change: Partial<AppSettings>) => {
      const next = await settings.updateApp(change);
      if (change.marketplaceUrl !== undefined) marketplace.forgetIndex();
      if (change.textSize !== undefined) this.services.windows.setZoom(next.textSize / 100);
      if (change.autoUpdate !== undefined) this.services.updates.setAutomatic(next.autoUpdate);
      this.broadcast('settings', 'changed', next);
      return next;
    });
  }

  private registerMarketplace(): void {
    const { marketplace } = this.services;
    this.handle('marketplace', 'list', (_e, kind: MarketplaceKind) => marketplace.fetchList(kind));
    this.handle('marketplace', 'installLanguage', (_e, id: string, version?: string) => marketplace.installModule('language', id, version));
    this.handle('marketplace', 'installExtension', (_e, id: string, version?: string) => marketplace.installModule('extension', id, version));
    this.handle('marketplace', 'installTheme', async (_e, id: string, version?: string) => {
      await marketplace.installTheme(id, version);
      this.broadcast('themes', 'listChanged');
    });
  }

  /** Sends an event to every open window. */
  broadcast(area: string, name: string, ...args: unknown[]): void {
    for (const win of this.services.windows.all()) this.send(win.webContents, area, name, ...args);
  }

  /** Sends an event to the editor window showing `projectPath`, if it's open. */
  sendToProject(projectPath: string, area: string, name: string, ...args: unknown[]): void {
    const win = this.services.windows.editorFor(projectPath);
    if (win) this.send(win.webContents, area, name, ...args);
    const debugWin = area === 'debug' ? this.services.windows.debugWindowFor(projectPath) : undefined;
    if (debugWin && !debugWin.isDestroyed()) this.send(debugWin.webContents, area, name, ...args);
  }

  private readonly replies = new Map<number, { resolve: (value: unknown) => void; reject: (e: Error) => void }>();
  private nextReply = 0;

  requestFromProject<T>(projectPath: string, name: string, ...args: unknown[]): Promise<T> {
    const win = this.services.windows.editorFor(projectPath);
    if (!win) return Promise.reject(new Error('That project is not open'));
    const id = ++this.nextReply;
    return new Promise<T>((resolve, reject) => {
      this.replies.set(id, { resolve: resolve as (value: unknown) => void, reject });
      win.once('closed', () => this.replies.get(id)?.reject(new Error('The window closed')));
      this.send(win.webContents, 'modules', name, id, ...args);
    }).finally(() => this.replies.delete(id));
  }

  /** Marketplace → Upload: asks for a folder or a .zip file to install; null if cancelled. */
  private async pickUpload(e: IpcMainInvokeEvent, source: 'folder' | 'zip', what: string): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.senderWindow(e), source === 'zip'
      ? { title: `Install ${what} from a zip file`, properties: ['openFile'], filters: [{ name: 'Zip files', extensions: ['zip'] }] }
      : { title: `Install ${what} from a folder`, properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  private registerModules(): void {
    const { modules, host, languageServers, windows } = this.services;
    const ctx = (e: IpcMainInvokeEvent) => ({ projectPath: this.projectOf(e) });

    // Installing, listing and removing, per kind: "languages" and "extensions".
    for (const [area, kind] of [['languages', 'language'], ['extensions', 'extension']] as const) {
      this.handle(area, 'list', () => modules.summaries(kind));
      this.handle(area, 'installDialog', async (e, source: 'folder' | 'zip' = 'folder') => {
        const picked = await this.pickUpload(e, source, kind === 'language' ? 'a language' : 'an extension');
        if (!picked) return null;
        const install = (dir: string) => modules.install(kind, dir);
        const manifest = source === 'zip' ? await withLocalZip(picked, MANIFEST_FILES[kind], install) : await install(picked);
        return (await modules.summaries(kind)).find((m) => m.id === manifest.id) ?? null;
      });
      this.handle(area, 'uninstall', (_e, id: string) => modules.uninstall(kind, id));
    }
    this.handle('languages', 'grammar', (_e, languageId: string) => modules.grammar(languageId));
    this.handle('languages', 'grammarByScope', (_e, scopeName: string) => modules.grammarByScope(scopeName));
    this.handle('languages', 'complete', (e, req: CompletionRequest) => languageServers.complete(this.projectOf(e), req));
    this.handle('languages', 'hover', (e, req: CompletionRequest) => languageServers.hover(this.projectOf(e), req));
    this.handle('languages', 'definition', (e, req: CompletionRequest) => languageServers.definition(this.projectOf(e), req));
    this.handle('languages', 'versions', (e) => this.services.languageVersions.forProject(this.projectOf(e)));
    this.handle('languages', 'versionChoices', (e, languageId: string) => host.languageVersions(languageId, ctx(e)));
    const chooseVersion = async (e: IpcMainInvokeEvent, languageId: string, version: LanguageVersion) => {
      const projectPath = this.projectOf(e);
      const all = await this.services.languageVersions.set(projectPath, languageId, version);
      this.sendToProject(projectPath, 'languages', 'versionsChanged', all);
      await host.languageVersionChanged(languageId, version, { projectPath });
    };
    this.handle('languages', 'setVersion', (e, languageId: string, version: LanguageVersion) => chooseVersion(e, languageId, version));
    this.handle('languages', 'addVersion', async (e, languageId: string, title: string) => {
      const picked = await dialog.showOpenDialog(this.senderWindow(e), { title, properties: ['openDirectory'] });
      const folder = picked.canceled ? null : picked.filePaths[0];
      if (!folder) return null;
      const version = await host.languageVersionAdd(languageId, folder, ctx(e));
      await chooseVersion(e, languageId, version);
      return version;
    });
    this.handle('languages', 'symbols', (e, req: DocumentRequest) => languageServers.symbols(this.projectOf(e), req));
    this.handle('languages', 'references', (e, req: CompletionRequest) => languageServers.references(this.projectOf(e), req));
    this.handle('languages', 'rename', (e, req: CompletionRequest & { newName: string }) => languageServers.rename(this.projectOf(e), req));
    this.handle('languages', 'codeActions', (e, req: CodeActionRequest) => languageServers.codeActions(this.projectOf(e), req));
    this.handle('languages', 'inlayHints', (e, req: DocumentRequest & { fromLine: number; toLine: number }) => languageServers.inlayHints(this.projectOf(e), req));
    this.handle('languages', 'codeLenses', (e, req: DocumentRequest) => languageServers.codeLenses(this.projectOf(e), req));
    this.handle('languages', 'runCodeLens', (e, languageId: string, path: string, index: number) => languageServers.runCodeLens(this.projectOf(e), languageId, path, index));
    this.handle('languages', 'semanticTokens', (e, req: DocumentRequest) => languageServers.semanticTokens(this.projectOf(e), req));
    this.handle('languages', 'runCodeAction', (e, languageId: string, index: number) => languageServers.runCodeAction(this.projectOf(e), languageId, index));
    this.handle('languages', 'format', (e, req: DocumentRequest & { tabSize: number; insertSpaces: boolean }) => languageServers.format(this.projectOf(e), req));
    this.handle('languages', 'signatureHelp', (e, req: CompletionRequest) => languageServers.signatureHelp(this.projectOf(e), req));
    this.handle('languages', 'syncDocument', async (e, req: { path: string; languageId: string; text: string }) => {
      await languageServers.sync(this.projectOf(e), req);
    });
    this.handle('languages', 'closeDocument', (e, req: { path: string; languageId: string }) => languageServers.close(this.projectOf(e), req));

    // What both kinds share at runtime: contributions, enabling, settings and calls into module code.
    this.handle('modules', 'snapshot', () => modules.snapshot());
    this.handle('modules', 'setEnabled', (_e, id: string, enabled: boolean) => modules.setEnabled(id, enabled));
    this.handle('modules', 'settings', (_e, moduleId: string) => modules.settings(moduleId));
    this.handle('modules', 'setSetting', (_e, moduleId: string, id: string, value: SettingValue) => modules.setSetting(moduleId, id, value));
    this.handle('modules', 'runCommand', (e, id: string) => host.runCommand(id, ctx(e)));
    this.handle('modules', 'treeChildren', (e, panelId: string, parentId: string | null) => host.treeChildren(panelId, parentId, ctx(e)));
    this.handle('modules', 'treeAction', (e, panelId: string, actionId: string, item: TreeItem) => host.treeAction(panelId, actionId, item, ctx(e)));
    this.handle('tests', 'discover', (e) => host.testsDiscover(ctx(e)));
    this.handle('tests', 'cancel', (_e, runId: string) => host.testsCancel(runId));
    this.handle('tests', 'sets', (e) => this.services.testSets.list(this.projectOf(e)));
    this.handle('tests', 'saveSet', (e, set: TestSet) => this.services.testSets.save(this.projectOf(e), set));
    this.handle('tests', 'removeSet', (e, name: string) => this.services.testSets.remove(this.projectOf(e), name));
    this.handle('tests', 'debug', async (e, controllerId: string, ids: string[] | null) => {
      const projectPath = this.projectOf(e);
      const target = await host.testsDebug(controllerId, ids, { projectPath });
      if (!target || typeof target.languageId !== 'string' || typeof target.launch !== 'object') throw new Error("The test runner didn't say how to debug these tests");
      await this.services.debug.start(projectPath, { path: projectPath, languageId: target.languageId, launch: target.launch, name: target.name ?? 'Tests' });
    });
    this.handle('tests', 'run', (e, controllerId: string, ids: string[] | null, runId: string, coverage?: boolean) => host.testsRun(controllerId, ids, runId, ctx(e), !!coverage));
    this.handle('modules', 'renderPreview', (e, id: string, text: string, path: string) => host.renderPreview(id, text, { ...ctx(e), path }));
    this.handle('modules', 'reply', (_e, id: number, value: unknown, error?: string) => {
      const pending = this.replies.get(id);
      if (error) pending?.reject(new Error(error));
      else pending?.resolve(value);
    });
    this.handle('modules', 'symbolRenamed', (e, event: SymbolRename) => host.symbolRenamed(event, ctx(e)));
    this.handle('modules', 'docComment', (e, languageId: string, request: DocCommentRequest) => host.docComment(languageId, request, ctx(e)));
    this.handle('modules', 'templateFile', (e, id: string, name: string, dir: string) => host.templateFile(id, { ...ctx(e), name, dir }));
    this.handle('modules', 'webviewHtml', (e, panelId: string) => host.webviewHtml(panelId, ctx(e)));
    this.handle('modules', 'webviewMessage', (e, panelId: string, message: unknown) => host.webviewMessage(panelId, message, ctx(e)));
    // Editor windows report their open files, active file and selection for `saturn.editor`.
    this.on('modules', 'editorEvent', (e, event: EditorEvent) => {
      const projectPath = windows.projectOf(this.senderWindow(e));
      if (projectPath) host.editorEvent(projectPath, event);
    });

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
    this.on('windows', 'openWelcome', () => windows.openWelcome());
    this.on('windows', 'openDebugWindow', (e) => windows.openDebugWindow(this.projectOf(e)));
    this.on('windows', 'closeDebugWindow', (e) => windows.closeDebugWindow(this.projectOf(e)));
    this.on('windows', 'revealInProject', (e, path: string, line?: number) => {
      const projectPath = this.projectOf(e);
      this.sendToProject(projectPath, 'modules', 'openFile', path, line);
      windows.editorFor(projectPath)?.focus();
    });
    this.on('window', 'close', (e) => this.senderWindow(e).close());
    this.on('window', 'setDirty', (e, dirty: boolean) => windows.setDirty(this.senderWindow(e), dirty));
  }

  private registerProjects(): void {
    const { windows, recent, creator, modules, host } = this.services;
    /**
     * Languages are re-detected on every open (projects grow new languages). A project created as a
     * language keeps it first; otherwise the previously known main language stays first.
     */
    const openProject = async (path: string, createdAs?: string | null) => {
      const known = (await recent.list()).find((p) => p.path === path)?.languageIds ?? [];
      const detected = await modules.detectLanguages(path);
      const main = createdAs ?? known[0];
      await recent.touch(path, [...new Set([...(main ? [main] : []), ...detected])]);
      windows.openEditor(path);
    };

    this.handle('projects', 'recent', () => recent.list());
    this.handle('projects', 'removeRecent', (_e, path: string) => recent.remove(path));
    this.handle('projects', 'setLanguage', (_e, path: string, languageId: string) => recent.setLanguage(path, languageId));
    /** Moves a recent project's folder to the Trash and forgets it (the Welcome screen confirms first). */
    this.handle('projects', 'deleteProject', async (_e, path: string) => {
      if (!(await recent.list()).some((p) => p.path === path)) throw new Error('Only recent projects can be deleted here');
      if (windows.editorFor(path)) throw new Error(`Close ${basename(path)} before deleting it`);
      await shell.trashItem(path);
      await recent.remove(path);
    });
    this.handle('projects', 'openPath', async (_e, path: string) => {
      const exists = await stat(path).then((s) => s.isDirectory(), () => false);
      if (!exists) return 'missing';
      await openProject(path);
      return 'opened';
    });
    this.handle('projects', 'openDialog', async (e) => {
      const result = await dialog.showOpenDialog(this.senderWindow(e), { properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return false;
      await openProject(result.filePaths[0]);
      return true;
    });
    this.handle('projects', 'pickFolder', async (e) => {
      const result = await dialog.showOpenDialog(this.senderWindow(e), { properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    this.handle('projects', 'pickFile', async (e) => {
      const result = await dialog.showOpenDialog(this.senderWindow(e), { properties: ['openFile'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    this.handle('projects', 'create', async (e, req: NewProjectRequest) => {
      const sender = this.senderWindow(e);
      const path = await creator.create(req);
      if (req.languageId) {
        const owner = (await modules.snapshot()).newProject.find((n) => n.language === req.languageId);
        if (owner) {
          try {
            await host.createProject(owner.moduleId, { projectPath: path, fields: req.fields }, (message) => this.send(e.sender, 'projects', 'createProgress', message));
          } catch (err) {
            // A half-made project isn't kept: the folder was new, so it goes, and the page shows why.
            await rm(path, { recursive: true, force: true }).catch(() => undefined);
            throw err;
          }
        }
      }
      await openProject(path, req.languageId);
      sender.close();
      if (req.replaceProject) windows.editorFor(req.replaceProject)?.close();
    });
    // Clone into a new folder in parentDir, then open it like any project.
    this.handle('projects', 'clone', async (_e, url: string, parentDir: string) => {
      if (!url.trim()) throw new Error('Enter a repository URL');
      const path = await GitService.clone(url, parentDir);
      await openProject(path);
    });
    this.handle('projects', 'defaultParentDir', async () => {
      const chosen = (await this.services.settings.app()).projectsFolder;
      if (chosen && (await stat(chosen).then((s) => s.isDirectory(), () => false))) return chosen;
      const dev = join(homedir(), 'SaturnProjects');
      return mkdir(dev, { recursive: true }).then(() => dev, () => homedir());
    });
  }

  private registerThemes(): void {
    const { themes } = this.services;
    this.handle('themes', 'list', () => themes.list());
    this.handle('themes', 'active', () => themes.active());
    this.handle('themes', 'setActive', async (_e, id: string) => {
      this.broadcast('themes', 'changed', await themes.setActive(id));
    });
    this.handle('themes', 'mode', () => themes.mode());
    this.handle('themes', 'syncWithOs', () => themes.syncWithOs());
    this.handle('themes', 'setSyncWithOs', async (_e, on: boolean) => {
      this.broadcast('themes', 'changed', await themes.setSyncWithOs(on));
    });
    this.handle('themes', 'setMode', async (_e, mode: ThemeMode) => {
      this.broadcast('themes', 'changed', await themes.setMode(mode));
    });
    this.handle('themes', 'installDialog', async (e, source: 'folder' | 'zip' = 'folder') => {
      const picked = await this.pickUpload(e, source, 'a theme');
      if (!picked) return null;
      const installed = source === 'zip' ? await withLocalZip(picked, 'theme.json', (dir) => themes.install(dir)) : await themes.install(picked);
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
    const projectPath = this.projectOf(event);
    const service = new FileService(projectPath, async () => (await this.services.settings.app()).encoding);
    // One watcher per project window feeds both the explorer and modules (saturn.workspace.onDidChangeFiles).
    const stopWatching = service.watch((dir) => {
      this.send(sender, 'fs', 'changed', dir);
      this.services.host.filesChanged(projectPath, dir);
    });
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
    this.handle('fs', 'rename', (e, path: string, newName: string) => this.filesFor(e).rename(path, newName));
    this.handle('fs', 'move', (e, path: string, toDir: string) => this.filesFor(e).move(path, toDir));
    this.handle('fs', 'copy', (e, path: string, toDir: string) => this.filesFor(e).copy(path, toDir));
    /** Deletes without asking; Undo (`undoTrash` with the returned id) can bring it back for 30 seconds. */
    this.handle('fs', 'trash', (e, path: string) => this.services.trash.remove(this.filesFor(e).entry(path)));
    this.handle('fs', 'undoTrash', (_e, id: string) => this.services.trash.undo(id));
    this.handle('fs', 'reveal', (e, path: string) => {
      const root = this.projectOf(e);
      shell.showItemInFolder(resolve(root, path) === resolve(root) ? root : this.filesFor(e).entry(path));
    });
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
