import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, nativeTheme, net, protocol } from 'electron';
import { ICON_FILE_NAME, ICON_FILES, ICON_SCHEME } from '@shared/modules';
import { spawn } from 'node-pty';
import { AppPaths, RESET_MARKER } from './Helpers/AppPaths';
import { setUpAppMenu } from './Helpers/appMenu';
import { IpcRouter } from './IpcRouter';
import { ExtensionHostService } from './Services/ExtensionHostService';
import { LanguageServerService } from './Services/LanguageServerService';
import { MarketplaceService } from './Services/MarketplaceService';
import { NotificationService } from './Services/NotificationService';
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

export class SaturnApp {
  constructor() {
    // Names the app in menus ("Quit Saturn"). In development macOS still shows "Electron" as the bold
    // menu-bar title and Dock label, because those come from Electron's app bundle; packaging fixes them.
    app.setName('Saturn');
    // Must run before 'ready' so every store and Chromium profile lands in the override.
    if (process.env.SATURN_USER_DATA) app.setPath('userData', process.env.SATURN_USER_DATA);
    // Reset Saturn left a marker: wipe the app-data folder now, before Chromium or any store opens it,
    // so Saturn starts as new (with the first-launch popup).
    const userData = app.getPath('userData');
    if (existsSync(join(userData, RESET_MARKER))) rmSync(userData, { recursive: true, force: true });
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
    app.dock?.setIcon(join(app.getAppPath(), 'resources/icons/icon.png'));
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
    const notifications = new NotificationService();
    notifications.onChanged((items) => router?.broadcast('notifications', 'changed', items));
    const languageServers = new LanguageServerService({
      diagnostics: (projectPath, path, diagnostics) => router?.sendToProject(projectPath, 'languages', 'diagnostics', path, diagnostics),
      message: (message) => router?.broadcast('modules', 'message', message),
      notify: (n) => notifications.add(n),
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
    });
    // Closing a project's window: modules release what they hold for it, and its language servers stop.
    windows.onEditorClosed((projectPath) => {
      host.projectClosed(projectPath);
      languageServers.stopProject(projectPath);
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
      marketplace: new MarketplaceService(modules, themes, async () => (await settings.app()).marketplaceUrl),
    });
    router.register();

    // Module changes apply live: restart the host and language servers, then tell every window.
    const reloadModules = async () => {
      const active = await modules.active();
      languageServers.setModules(await modules.activeLanguages());
      await host.restart(active).catch((e) => console.error('Extension host failed to start', e));
      router?.broadcast('modules', 'changed', await modules.snapshot());
    };
    modules.onChanged(() => void reloadModules());
    // Setting changes apply without a restart: the module and its language server get the new values.
    modules.onSettingsChanged((moduleId, values) => {
      host.settingsChanged(moduleId, values);
      languageServers.settingsChanged(moduleId, values);
      router?.broadcast('modules', 'settingsChanged', moduleId, values);
    });
    await reloadModules();
    // Quitting waits (briefly) for modules' deactivate() before stopping the host.
    let shutDown = false;
    app.on('before-quit', (event) => {
      languageServers.stopAll();
      if (shutDown) return;
      event.preventDefault();
      void host.shutdown().finally(() => {
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

    const welcome = windows.openWelcome();
    // First launch: the welcome popup shows once; closing it any way counts as done.
    if (!(await settings.get()).onboarded) {
      windows.openOnboarding(welcome).on('closed', () => void settings.setOnboarded());
    }
    app.on('activate', () => {
      if (windows.all().length === 0) windows.openWelcome();
    });
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
