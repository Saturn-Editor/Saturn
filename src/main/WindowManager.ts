import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, shell, type BrowserWindowConstructorOptions } from 'electron';
import { channel } from '@shared/api';
import type { WindowKind } from '@shared/types';

const SIZES: Record<WindowKind, { width: number; height: number; minWidth?: number; minHeight?: number }> = {
  welcome: { width: 900, height: 600 },
  editor: { width: 1400, height: 900, minWidth: 800, minHeight: 500 },
  settings: { width: 720, height: 520 },
  'new-project': { width: 820, height: 560 },
  marketplace: { width: 860, height: 560 },
  onboarding: { width: 560, height: 640 },
};

/** Window/taskbar icon: .ico on Windows, .png elsewhere (macOS uses the Dock icon set in SaturnApp). */
export function windowIcon(): string {
  return join(app.getAppPath(), 'resources/icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

export class WindowManager {
  private welcome: BrowserWindow | null = null;
  private readonly editors = new Map<string, BrowserWindow>();
  private readonly debugWindows = new Map<string, BrowserWindow>();
  private readonly singles = new Map<WindowKind, BrowserWindow>();
  private readonly dirty = new Set<number>();
  private readonly closeConfirmed = new Set<number>();
  private runningIn: (webContentsId: number) => string[] = () => [];

  setRunningCheck(check: (webContentsId: number) => string[]): void {
    this.runningIn = check;
  }
  private quitting = false;
  /** Appearance → Text size, as a zoom factor applied to every window. */
  private zoom = 1;
  private readonly editorClosedListeners: ((projectPath: string) => void)[] = [];
  private readonly editorOpenedListeners: ((projectPath: string) => void)[] = [];

  /** Called with the project path whenever a new editor window opens. */
  onEditorOpened(listener: (projectPath: string) => void): void {
    this.editorOpenedListeners.push(listener);
  }

  /** Called with the project path whenever an editor window has closed. */
  onEditorClosed(listener: (projectPath: string) => void): void {
    this.editorClosedListeners.push(listener);
  }

  constructor() {
    app.on('before-quit', () => (this.quitting = true));
  }

  openWelcome(): BrowserWindow {
    if (this.welcome && !this.welcome.isDestroyed()) {
      this.welcome.focus();
      return this.welcome;
    }
    const win = this.create('welcome');
    win.on('closed', () => (this.welcome = null));
    this.welcome = win;
    return win;
  }

  openNotebook(notebookPath: string): BrowserWindow {
    return this.openEditor(notebookPath, 'notebook');
  }

  openDebugWindow(projectPath: string): BrowserWindow | null {
    const key = resolve(projectPath);
    const owner = this.editors.get(key);
    if (!owner) return null;
    const existing = this.debugWindows.get(key);
    if (existing && !existing.isDestroyed()) return existing;
    const win = this.create('editor', { project: key, mode: 'debug' }, { width: 900, height: 700 });
    this.debugWindows.set(key, win);
    win.on('closed', () => this.debugWindows.delete(key));
    owner.once('closed', () => this.closeDebugWindow(key));
    return win;
  }

  closeDebugWindow(projectPath: string): void {
    const win = this.debugWindows.get(resolve(projectPath));
    if (win && !win.isDestroyed()) win.close();
  }

  debugWindowFor(projectPath: string): BrowserWindow | undefined {
    return this.debugWindows.get(resolve(projectPath));
  }

  openProjectType(projectPath: string, typeId: string): BrowserWindow {
    return this.openEditor(projectPath, 'projectType', typeId);
  }

  openEditor(projectPath: string, mode: 'project' | 'notebook' | 'projectType' = 'project', typeId?: string): BrowserWindow {
    const key = resolve(projectPath);
    const existing = this.editors.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return existing;
    }
    const win = this.create('editor', { project: key, mode, ...(typeId && { type: typeId }) });
    this.editors.set(key, win);
    this.editorOpenedListeners.forEach((l) => l(key));
    win.on('close', (event) => {
      if (!this.dirty.has(win.id)) {
        const running = this.runningIn(win.webContents.id);
        if (!running.length || this.closeConfirmed.has(win.id)) return;
        event.preventDefault();
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          message: `${[...new Set(running)].join(', ')} is still running in a terminal.`,
          detail: 'Closing the window stops it.',
          buttons: ['Close Anyway', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        });
        if (choice === 0) {
          this.closeConfirmed.add(win.id);
          win.close();
        }
        return;
      }
      event.preventDefault();
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        message: 'You have unsaved changes.',
        buttons: ['Save All', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice === 0) win.webContents.send(channel('window', 'saveAll'));
      if (choice === 1) {
        this.dirty.delete(win.id);
        win.close();
      }
    });
    win.on('closed', () => {
      this.dirty.delete(win.id);
      this.editors.delete(key);
      this.editorClosedListeners.forEach((l) => l(key));
      if (this.editors.size === 0 && !this.quitting) this.openWelcome();
    });
    this.welcome?.close();
    return win;
  }

  openSettings(parent: BrowserWindow, section?: string): BrowserWindow {
    return this.openSingle('settings', parent, section ? { section } : {});
  }

  /** Opened from an editor, the window knows its project, so it can offer to open the new one in its place. */
  openNewProject(parent: BrowserWindow): BrowserWindow {
    const from = this.projectOf(parent);
    return this.openSingle('new-project', parent, from ? { project: from } : {});
  }

  openMarketplace(parent: BrowserWindow, section?: string): BrowserWindow {
    return this.openSingle('marketplace', parent, section ? { section } : {});
  }

  /** The first-launch "Welcome to Saturn" popup, modal over the Welcome window. */
  openOnboarding(parent: BrowserWindow): BrowserWindow {
    const win = this.create('onboarding', {}, { parent, modal: true, resizable: false, minimizable: false });
    this.singles.set('onboarding', win);
    win.on('closed', () => this.singles.delete('onboarding'));
    return win;
  }

  /** Sets the text size (1 = 100%) on every open window and on ones opened later. */
  setZoom(factor: number): void {
    this.zoom = factor;
    for (const win of BrowserWindow.getAllWindows()) win.webContents.setZoomFactor(factor);
  }

  /** Editor windows with the project path each one shows. */
  editorWindows(): [string, BrowserWindow][] {
    return [...this.editors.entries()];
  }

  setDirty(win: BrowserWindow, dirty: boolean): void {
    if (dirty) this.dirty.add(win.id);
    else this.dirty.delete(win.id);
  }

  editorFor(projectPath: string): BrowserWindow | undefined {
    return this.editors.get(resolve(projectPath));
  }

  /** The project path an editor window was opened for, or null for other windows. */
  projectOf(win: BrowserWindow): string | null {
    for (const [path, w] of this.editors) if (w === win) return path;
    for (const [path, w] of this.debugWindows) if (w === win) return path;
    return null;
  }

  all(): BrowserWindow[] {
    return BrowserWindow.getAllWindows();
  }

  private openSingle(kind: WindowKind, parent: BrowserWindow, args: Record<string, string>): BrowserWindow {
    const existing = this.singles.get(kind);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return existing;
    }
    const win = this.create(kind, args, { parent });
    this.singles.set(kind, win);
    win.on('closed', () => this.singles.delete(kind));
    return win;
  }

  private create(kind: WindowKind, args: Record<string, string> = {}, extra: BrowserWindowConstructorOptions = {}): BrowserWindow {
    const additionalArguments = Object.entries({ window: kind, ...args }).map(
      ([k, v]) => `--saturn-${k}=${encodeURIComponent(v)}`,
    );
    const win = new BrowserWindow({
      ...SIZES[kind],
      ...extra,
      title: 'Saturn',
      icon: windowIcon(),
      // Hidden until the renderer has applied the theme and painted, so there's no colour flash.
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments,
      },
    });
    win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(this.zoom));
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url === win.webContents.getURL()) return;
      e.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url);
    });
    win.once('ready-to-show', () => win.show());
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    return win;
  }
}
