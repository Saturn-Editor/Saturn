import { BrowserWindow, session } from 'electron';

const PARTITION = 'saturn-sandbox';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30000;
const PAGE = `data:text/html,${encodeURIComponent(
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">`,
)}`;

let prepared = false;

function prepareSession(): Electron.Session {
  const s = session.fromPartition(PARTITION, { cache: false });
  if (prepared) return s;
  prepared = true;
  s.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith('data:') }));
  s.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  s.setPermissionCheckHandler(() => false);
  return s;
}

export function clampTimeout(timeout: number | undefined): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(timeout, MAX_TIMEOUT_MS);
}

export function wrapScript(code: string): string {
  return `(async () => {
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebSocket', 'EventSource', 'fetch', 'XMLHttpRequest', 'Worker', 'SharedWorker']) {
      try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false }); } catch {}
    }
    const result = await (async () => { ${code}\n })();
    return JSON.stringify(result === undefined ? null : result);
  })()`;
}

export class SandboxService {
  async run(code: string, timeout?: number): Promise<unknown> {
    if (typeof code !== 'string') throw new Error('The script must be text');
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: prepareSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await win.loadURL(PAGE);
      const json = await Promise.race([
        win.webContents.executeJavaScript(wrapScript(code), true) as Promise<string>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            if (!win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
            reject(new Error('The script took too long and was stopped'));
          }, clampTimeout(timeout));
        }),
      ]);
      return JSON.parse(json) as unknown;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e));
    } finally {
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
    }
  }
}
