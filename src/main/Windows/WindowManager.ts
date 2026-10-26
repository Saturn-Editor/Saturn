import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, type BrowserWindowConstructorOptions } from 'electron';
import { channel } from '@shared/api';
import type { WindowKind } from '@shared/types';

const SIZES: Record<WindowKind, { width: number; height: number; minWidth?: number; minHeight?: number }> = {
  welcome: { width: 900, height: 600 },
  editor: { width: 1400, height: 900, minWidth: 800, minHeight: 500 },
  settings: { width: 720, height: 520 },
  'new-project': { width: 820, height: 560 },
  marketplace: { width: 860, height: 560 },
};

/** Window/taskbar icon: .ico on Windows, .png elsewhere (macOS uses the Dock icon set in SaturnApp). */
export function windowIcon(): string {
  return join(app.getAppPath(), 'resources/icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

export class WindowManager {
  private welcome: BrowserWindow | null = null;
  private readonly editors = new Map<string, BrowserWindow>();
  private readonly singles = new Map<WindowKind, BrowserWindow>();
  private readonly dirty = new Set<number>();
  private quitting = false;

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

  openEditor(projectPath: string): BrowserWindow {
    const key = resolve(projectPath);
    const existing = this.editors.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return existing;
    }
    const win = this.create('editor', { project: key });
    this.editors.set(key, win);
    win.on('close', (event) => {
      if (!this.dirty.has(win.id)) return;
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
      if (this.editors.size === 0 && !this.quitting) this.openWelcome();
    });
    this.welcome?.close();
    return win;
  }

  openSettings(parent: BrowserWindow, section?: string): BrowserWindow {
    return this.openSingle('settings', parent, section ? { section } : {});
  }

  openNewProject(parent: BrowserWindow): BrowserWindow {
    return this.openSingle('new-project', parent, {});
  }

  openMarketplace(parent: BrowserWindow, section?: string): BrowserWindow {
    return this.openSingle('marketplace', parent, section ? { section } : {});
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
        additionalArguments,
      },
    });
    win.once('ready-to-show', () => win.show());
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    return win;
  }
}
