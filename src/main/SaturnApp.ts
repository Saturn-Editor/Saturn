import { join } from 'node:path';
import { app } from 'electron';
import { spawn } from 'node-pty';
import { AppPaths } from './Helpers/AppPaths';
import { setUpAppMenu } from './Helpers/appMenu';
import { IpcRouter } from './Ipc/IpcRouter';
import { ExtensionHostService } from './Services/ExtensionHostService';
import { LanguageServerService } from './Services/LanguageServerService';
import { ModuleService } from './Services/ModuleService';
import { ProjectCreator } from './Services/ProjectCreator';
import { ModuleStateStore } from './Store/ModuleStateStore';
import { TerminalService, type PtyFactory } from './Services/TerminalService';
import { ThemeService } from './Services/ThemeService';
import { LayoutStore } from './Store/LayoutStore';
import { RecentProjectsStore } from './Store/RecentProjectsStore';
import { RunConfigStore } from './Store/RunConfigStore';
import { SettingsStore } from './Store/SettingsStore';
import { WindowManager } from './Windows/WindowManager';

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
    const themes = new ThemeService(
      join(app.getAppPath(), 'resources/themes'),
      paths.dir('themes'),
      new SettingsStore(paths.file('settings.json')),
    );
    const windows = new WindowManager();
    const modules = new ModuleService(paths.dir('modules'), new ModuleStateStore(paths.file('modules.json')));
    const languageServers = new LanguageServerService();
    let router: IpcRouter | null = null;
    const host = new ExtensionHostService({
      openFile: (projectPath, path, line) => router?.sendToProject(projectPath, 'modules', 'openFile', path, line),
      refreshPanel: (panelId) => router?.broadcast('modules', 'treeRefresh', panelId),
      crashed: (message) => router?.broadcast('modules', 'hostProblem', message),
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
    await reloadModules();
    app.on('before-quit', () => {
      host.stop();
      languageServers.stopAll();
    });

    windows.openWelcome();
    app.on('activate', () => {
      if (windows.all().length === 0) windows.openWelcome();
    });
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
