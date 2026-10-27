import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, nativeTheme, net, protocol } from 'electron';
import { channel } from '@shared/api';
import { ICON_FILE_NAME, ICON_FILES, ICON_SCHEME } from '@shared/modules';
import { spawn } from 'node-pty';
import { AppPaths, SATURN_DATA } from './Helpers/AppPaths';
import { setUpAppMenu } from './Helpers/appMenu';
import { adoptLoginShellPath } from './Helpers/loginShellPath';
import { IpcRouter } from './IpcRouter';
import { ExtensionHostService } from './Services/ExtensionHostService';
import { LanguageServerService } from './Services/LanguageServerService';
import { MarketplaceService } from './Services/MarketplaceService';
import { NotificationService } from './Services/NotificationService';
import { UpdateService } from './Services/UpdateService';
import { DebugService } from './Services/DebugService';
import { AskpassService } from './Services/AskpassService';
import { TrashService } from './Services/TrashService';
import { LanguageChoiceStore } from './Store/LanguageChoiceStore';
import { setAskpass } from './Services/GitService';
import { BreakpointStore } from './Store/BreakpointStore';
import { CodeModuleService } from './Services/CodeModuleService';
import { ProjectCreator } from './Services/ProjectCreator';
import { ModuleSettingsStore } from './Store/ModuleSettingsStore';
import { ModuleStateStore } from './Store/ModuleStateStore';
import { TerminalService, type PtyFactory } from './Services/TerminalService';
import { ThemeService } from './Services/ThemeService';
import { LayoutStore } from './Store/LayoutStore';
import { RecentProjectsStore } from './Store/RecentProjectsStore';
import { RunConfigStore } from './Store/RunConfigStore';
import { SettingsStore } from './Store/SettingsStore';
import { WindowManager } from './WindowManager';

const nodePtyFactory: PtyFactory = (shell, args, opts) => {
  const pty = spawn(shell, args, { name: 'xterm-256color', ...opts });
  return {
    onData: (cb) => void pty.onData(cb),
    onExit: (cb) => void pty.onExit(({ exitCode }) => cb(exitCode)),
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
  };
};

/** How often installed languages, extensions and themes are checked for updates. */
const MARKETPLACE_CHECK_MS = 6 * 60 * 60 * 1000;

export class SaturnApp {
  constructor() {
    // Names the app in menus ("Quit Saturn"). In development macOS still shows "Electron" as the bold
    // menu-bar title and Dock label, because those come from Electron's app bundle; packaging fixes them.
    app.setName('Saturn');
    // Must run before 'ready' so every store and Chromium profile lands in the override.
    if (process.env.SATURN_USER_DATA) app.setPath('userData', process.env.SATURN_USER_DATA);
    // Before anything spawns tools (language servers, git, terminals) that must be found on PATH.
    if (app.isPackaged) adoptLoginShellPath();
    // Installed languages', extensions' and themes' icon.svg / icon.png, served to windows (see serveIcons).
    protocol.registerSchemesAsPrivileged([{ scheme: ICON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  }

  /**
   * saturn-icon://module/<id> and saturn-icon://theme/<id>: the item's icon.svg, else icon.png, else 404.
   * saturn-icon://module/<id>/<file>: a panel's or button's own icon file in the module folder.
   */
  private serveIcons(modules: CodeModuleService, themesDir: string): void {
    protocol.handle(ICON_SCHEME, async (request) => {
      const { hostname, pathname } = new URL(request.url);
      const [id, ...rest] = pathname.slice(1).split('/').map(decodeURIComponent);
      const own = rest.length ? rest.join('/') : undefined;
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(id ?? '') || (own !== undefined && !ICON_FILE_NAME.test(own))) return new Response(null, { status: 404 });
      const dir = hostname === 'module'
        ? (await modules.list()).find((m) => m.manifest.id === id)?.dir
        : hostname === 'theme' ? join(themesDir, id) : undefined;
      const file = dir && (own ? [own] : ICON_FILES).map((f) => join(dir, f)).find((f) => existsSync(f));
      return file ? net.fetch(pathToFileURL(file).href) : new Response(null, { status: 404 });
    });
  }

  async start(): Promise<void> {
    await app.whenReady();
    // In development the Dock would show Electron's icon, so it's replaced with ours (a PNG: keep it in
    // step with icon.icns). Packaged builds use icon.icns from the app bundle and are left alone.
    if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'resources/icons/icon.png'));
    setUpAppMenu();
    const paths = new AppPaths(app.getPath('userData'));
    const settings = new SettingsStore(paths.file('settings.json'));
    const themes = new ThemeService(
      join(app.getAppPath(), 'resources/themes'),
      paths.dir('themes'),
      settings,
      () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    );
    const windows = new WindowManager();
    const modules = new CodeModuleService(
      { language: paths.dir('languages'), extension: paths.dir('extensions') },
      new ModuleStateStore(paths.file('modules.json')),
      new ModuleSettingsStore(paths.file('module-settings.json')),
      paths.dir('module-storage'),
    );
    this.serveIcons(modules, paths.dir('themes'));
    let router: IpcRouter | null = null;
    // Set once everything it needs exists (below).
    let resetSaturn: () => Promise<void> = async () => undefined;
    const notifications = new NotificationService();
    notifications.onChanged((items) => router?.broadcast('notifications', 'changed', items));
    // Saturn updates: windows see progress; a downloaded update posts a "restart to update" notification.
    const updates = new UpdateService();
    updates.onChanged((status) => {
      router?.broadcast('updates', 'changed', status);
      if (status.state === 'available' && status.downloadUrl) {
        notifications.add({
          moduleId: 'saturn',
          title: `Saturn ${status.version} is available`,
          message: "This copy of Saturn can't update itself. Download the new version and replace the app in Applications.",
          actions: [{ label: 'Download', url: status.downloadUrl }],
        });
      }
      if (status.state === 'ready') {
        notifications.add({
          moduleId: 'saturn',
          title: `Saturn ${status.version} is ready to install`,
          message: 'Restart Saturn to finish updating. It also installs when you next quit.',
          actions: [{ label: 'Restart to update', installUpdate: true }],
        });
      }
    });
    // Git asks for credentials (push, pull, clone) in the project's window, or the focused one for a clone.
    const askpass = new AskpassService(paths.dir('askpass'), {
      prompt: (projectPath, id, text, secret) => {
        const win = (projectPath && windows.editorFor(projectPath)) || BrowserWindow.getFocusedWindow() || windows.all()[0];
        if (win) win.webContents.send(channel('git', 'credentialPrompt'), id, text, secret);
        else askpass.answer(id, null);
      },
    });
    await askpass.start().then(() => setAskpass((projectPath) => askpass.env(projectPath)), (e) => console.error('Git sign-in prompts unavailable', e));
    // Deleting files: held for Undo, then sent to the system Trash.
    const trash = new TrashService(paths.dir('deleted'));
    await trash.start().catch((e) => console.error('Clearing held deletions failed', e));
    const marketplace = new MarketplaceService(modules, themes, async () => (await settings.app()).marketplaceUrl);
    const languageServers = new LanguageServerService({
      diagnostics: (projectPath, path, diagnostics) => router?.sendToProject(projectPath, 'languages', 'diagnostics', path, diagnostics),
      message: (message) => router?.broadcast('modules', 'message', message),
      notify: (n) => notifications.add(n),
    });
    const debug = new DebugService(new BreakpointStore(paths.file('breakpoints.json')), {
      changed: (projectPath, state) => router?.sendToProject(projectPath, 'debug', 'changed', state),
      output: (projectPath, text, category) => router?.sendToProject(projectPath, 'debug', 'output', text, category),
      message: (projectPath, message, kind) => router?.sendToProject(projectPath, 'modules', 'message', { message, kind, moduleId: 'saturn' }),
      runInTerminal: (projectPath, title, command) => router?.sendToProject(projectPath, 'modules', 'runInTerminal', title, command),
    });
    const host = new ExtensionHostService({
      openFile: (projectPath, path, line, column) => router?.sendToProject(projectPath, 'modules', 'openFile', path, line, column),
      refreshPanel: (panelId, itemId) => router?.broadcast('modules', 'treeRefresh', panelId, itemId),
      showMessage: (message) => {
        if (message.projectPath) router?.sendToProject(message.projectPath, 'modules', 'message', message);
        else router?.broadcast('modules', 'message', message);
      },
      notify: (n) => notifications.add(n),
      restartLanguageServer: (moduleId) => languageServers.restartModule(moduleId),
      runInTerminal: (projectPath, name, command) => router?.sendToProject(projectPath, 'modules', 'runInTerminal', name, command),
      crashed: (message) => router?.broadcast('modules', 'message', { message, kind: 'error', moduleId: 'saturn' }),
      webviewPost: (panelId, projectPath, message) => (projectPath
        ? router?.sendToProject(projectPath, 'modules', 'webviewPost', panelId, message)
        : router?.broadcast('modules', 'webviewPost', panelId, message)),
      webviewRefresh: (panelId) => router?.broadcast('modules', 'webviewRefresh', panelId),
    });
    // Closing a project's window: modules release what they hold for it, and its language servers stop.
    windows.onEditorOpened((projectPath) => host.projectOpened(projectPath));
    windows.onEditorClosed((projectPath) => {
      host.projectClosed(projectPath);
      languageServers.stopProject(projectPath);
      void debug.stop(projectPath);
    });

    router = new IpcRouter({
      windows,
      themes,
      recent: new RecentProjectsStore(paths.file('recent-projects.json')),
      creator: new ProjectCreator(),
      layouts: new LayoutStore(paths),
      terminals: new TerminalService(nodePtyFactory),
      runs: new RunConfigStore(paths),
      modules,
      host,
      languageServers,
      settings,
      paths,
      notifications,
      updates,
      debug,
      askpass,
      trash,
      languageChoices: new LanguageChoiceStore(paths.file('language-choices.json')),
      marketplace,
      reset: () => resetSaturn(),
    });
    router.register();

    // Module changes apply live: restart the host and language servers, then tell every window.
    const reloadModules = async () => {
      const active = await modules.active();
      languageServers.setModules(await modules.activeLanguages());
      debug.setModules(await modules.activeLanguages());
      await host.restart(active).catch((e) => console.error('Extension host failed to start', e));
      // Freshly activated modules hear about projects that are already open.
      for (const [projectPath] of windows.editorWindows()) host.projectOpened(projectPath);
      router?.broadcast('modules', 'changed', await modules.snapshot());
    };
    modules.onChanged(() => void reloadModules());
    // Setting changes apply without a restart: the module and its language server get the new values.
    modules.onSettingsChanged((moduleId, values) => {
      host.settingsChanged(moduleId, values);
      languageServers.settingsChanged(moduleId, values);
      router?.broadcast('modules', 'settingsChanged', moduleId, values);
      // Language feature switches change what editors get, so windows receive fresh contributions too.
      void modules.snapshot().then((snap) => router?.broadcast('modules', 'changed', snap));
    });
    await reloadModules();
    // Quitting waits (briefly) for modules' deactivate() before stopping the host.
    let shutDown = false;
    app.on('before-quit', (event) => {
      languageServers.stopAll();
      debug.stopAll();
      askpass.stop();
      if (shutDown) return;
      event.preventDefault();
      void Promise.all([host.shutdown(), trash.finishAll()]).finally(() => {
        shutDown = true;
        app.quit();
      });
    });

    // Sync with OS: re-theme every window when the system switches between light and dark.
    nativeTheme.on('updated', () => {
      void themes.syncWithOs().then(async (on) => on && router?.broadcast('themes', 'changed', await themes.active()));
    });
    // Text size scales every window, including ones opened later.
    windows.setZoom((await settings.app()).textSize / 100);
    updates.setAutomatic((await settings.app()).autoUpdate);
    // Installed languages, extensions and themes: a notification when the marketplace has newer
    // versions (checked with Saturn's own updates), once per set of new versions.
    let notifiedUpdates = '';
    const checkMarketplace = async () => {
      if (!(await settings.app()).autoUpdate) return;
      const found = await marketplace.availableUpdates().catch(() => []);
      const key = found.map((u) => `${u.kind}:${u.id}@${u.to}`).join();
      if (!found.length || key === notifiedUpdates) return;
      notifiedUpdates = key;
      notifications.add({
        moduleId: 'saturn',
        title: found.length === 1 ? `An update for ${found[0].name} is available` : `${found.length} updates are available`,
        message: found.map((u) => `${u.name} ${u.from} → ${u.to}`).join(', '),
        actions: [{ label: found.length === 1 ? 'Update' : 'Update all', updateAll: true }, { label: 'Open Marketplace', openMarketplace: found[0].kind }],
      });
    };
    void checkMarketplace();
    setInterval(() => void checkMarketplace(), MARKETPLACE_CHECK_MS);

    const openStartWindows = async () => {
      const welcome = windows.openWelcome();
      // First launch: the welcome popup shows once; closing it any way counts as done.
      if (!(await settings.get()).onboarded) {
        windows.openOnboarding(welcome).on('closed', () => void settings.setOnboarded());
      }
    };
    await openStartWindows();

    // Reset Saturn (already confirmed): close every window without asking about unsaved changes, stop
    // module code, delete Saturn's own data, then start over as on a first launch. No relaunch, so it
    // works the same in development and in packaged builds.
    resetSaturn = async () => {
      for (const win of windows.all()) win.destroy();
      await host.shutdown();
      languageServers.stopAll();
      debug.stopAll();
      notifications.clear();
      await Promise.all(SATURN_DATA.map((name) => rm(join(paths.root, name), { recursive: true, force: true })));
      windows.setZoom(1);
      await reloadModules();
      router?.broadcast('themes', 'changed', await themes.active());
      await openStartWindows();
    };
    app.on('activate', () => {
      if (windows.all().length === 0) windows.openWelcome();
    });
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
