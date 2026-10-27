import { join } from 'node:path';
import { app, nativeTheme } from 'electron';
import { spawn } from 'node-pty';
import { AppPaths } from './Helpers/AppPaths';
import { setUpAppMenu } from './Helpers/appMenu';
import { IpcRouter } from './IpcRouter';
import { ExtensionHostService } from './Services/ExtensionHostService';
import { LanguageServerService } from './Services/LanguageServerService';
import { MarketplaceService } from './Services/MarketplaceService';
import { ModuleService } from './Services/ModuleService';
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
    const modules = new ModuleService(
      paths.dir('modules'),
      new ModuleStateStore(paths.file('modules.json')),
      new ModuleSettingsStore(paths.file('module-settings.json')),
    );
    let router: IpcRouter | null = null;
    const languageServers = new LanguageServerService({
      diagnostics: (projectPath, path, diagnostics) => router?.sendToProject(projectPath, 'modules', 'diagnostics', path, diagnostics),
      message: (message) => router?.broadcast('modules', 'message', message),
    });
    const host = new ExtensionHostService({
      openFile: (projectPath, path, line, column) => router?.sendToProject(projectPath, 'modules', 'openFile', path, line, column),
      refreshPanel: (panelId, itemId) => router?.broadcast('modules', 'treeRefresh', panelId, itemId),
      showMessage: (message) => {
        if (message.projectPath) router?.sendToProject(message.projectPath, 'modules', 'message', message);
        else router?.broadcast('modules', 'message', message);
      },
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
      marketplace: new MarketplaceService(modules, themes, async () => (await settings.app()).marketplaceUrl),
    });
    router.register();

    // Module changes apply live: restart the host and language servers, then tell every window.
    const reloadModules = async () => {
      const active = await modules.active();
      languageServers.setModules(active);
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
