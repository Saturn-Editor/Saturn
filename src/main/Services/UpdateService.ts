import { execFile } from 'node:child_process';
import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '@shared/types';

const { autoUpdater } = electronUpdater;

/** How often a running Saturn looks for a new release. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/Saturn-Editor/Saturn/releases';

/**
 * macOS only installs updates for apps signed with an Apple Developer ID (matching the new version's).
 * True when this copy of Saturn has one, i.e. its code signature names a team.
 */
function hasDeveloperId(): Promise<boolean> {
  const bundle = process.execPath.replace(/(\.app)\/.*$/, '$1');
  return new Promise((resolve) => {
    execFile('codesign', ['-dv', '--verbose=2', bundle], (error, _stdout, stderr) => {
      const team = /TeamIdentifier=(\S+)/.exec(stderr)?.[1];
      resolve(!error && !!team && team !== 'not');
    });
  });
}

/**
 * Updates from GitHub Releases (electron-updater). Normally new versions download in the background
 * and install on restart. An unsigned macOS build can't install updates, so there Saturn only says a
 * new version is available and links to its download page. Packaged builds only.
 */
export class UpdateService {
  private status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unavailable' };
  private readonly listeners: ((status: UpdateStatus) => void)[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  /** True when updates can't be installed automatically (unsigned macOS build). */
  private manual = false;
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.setUp();
  }

  private async setUp(): Promise<void> {
    if (!app.isPackaged) return;
    this.manual = process.platform === 'darwin' && !(await hasDeveloperId());
    autoUpdater.autoDownload = !this.manual;
    autoUpdater.autoInstallOnAppQuit = !this.manual;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => this.set(this.manual
      ? { state: 'available', version: info.version, downloadUrl: `${RELEASES_URL}/tag/v${info.version}` }
      : { state: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', version: this.status.version, percent: Math.round(p.percent) }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'up-to-date' }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: e.message }));
  }

  /** Called on every status change (e.g. to post the update notification). */
  onChanged(listener: (status: UpdateStatus) => void): void {
    this.listeners.push(listener);
  }

  current(): UpdateStatus {
    return this.status;
  }

  /** Starts or stops checking at launch and every few hours (Settings → Advanced → Check for updates automatically). */
  setAutomatic(on: boolean): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!on || !app.isPackaged) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  async check(): Promise<UpdateStatus> {
    await this.ready;
    if (!app.isPackaged) return this.status;
    if (this.status.state === 'ready' || this.status.state === 'downloading') return this.status;
    await autoUpdater.checkForUpdates().catch((e: Error) => this.set({ state: 'error', message: e.message }));
    return this.status;
  }

  /** Quits and installs a downloaded update, or (unsigned macOS) opens the new version's download page. */
  async install(): Promise<void> {
    if (this.status.state === 'ready') autoUpdater.quitAndInstall();
    else if (this.status.state === 'available' && this.status.downloadUrl) await shell.openExternal(this.status.downloadUrl);
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.listeners.forEach((l) => l(status));
  }
}
