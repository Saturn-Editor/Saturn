import { useEffect, useRef, useState } from 'preact/hooks';
import { PAGE_CSP } from '@shared/modules';
import { themeVariables } from '@renderer/theme/ThemeApplier';

const BRIDGE = `<script>
(() => {
  const listeners = [];
  const pending = new Map();
  let next = 0;
  const deliver = (message) => { for (const l of listeners) l(message); };
  const request = (method, args) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    parent.postMessage({ saturnRequest: true, id, method, args }, '*');
  });
  const isText = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(el.type)));
  const edit = (kind) => {
    if (isText(document.activeElement)) document.execCommand(kind);
    else deliver({ type: kind });
  };
  window.saturn = {
    postMessage: (message) => parent.postMessage({ saturnWebview: true, message }, '*'),
    onMessage: (callback) => { listeners.push(callback); },
    clipboard: {
      readText: () => request('clipboard.readText', []),
      writeText: (text) => request('clipboard.writeText', [String(text)]),
      writeImage: (dataUrl) => request('clipboard.writeImage', [String(dataUrl)]),
    },
    projectImage: (path) => request('projectImage', [String(path)]),
  };
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data) return;
    const d = e.data;
    if (d.saturnToWebview === true) deliver(d.message);
    else if (d.saturnTheme === true) {
      document.getElementById('saturn-theme').textContent = ':root { ' + d.css + ' }';
      deliver({ type: 'theme' });
    } else if (d.saturnEdit) edit(d.saturnEdit);
    else if (d.saturnResponse === true && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
    }
  });
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      parent.postMessage({ saturnKey: 'save' }, '*');
    } else if ((key === 'z' || key === 'y') && !isText(e.target)) {
      e.preventDefault();
      deliver({ type: key === 'y' || e.shiftKey ? 'redo' : 'undo' });
    }
  }, true);
})();
</script>`;

const CSP = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`;

const BASE_STYLE = `<style>html, body { margin: 0; height: 100%; } body { font: 12px/1.5 system-ui, sans-serif;
  background: var(--saturn-panel); color: var(--saturn-text); } a { color: var(--saturn-accent); }</style>`;

export function isTextTarget(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true' || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes((el as HTMLInputElement).type);
}

const frames = new Set<HTMLIFrameElement>();

export function focusedFrame(): HTMLIFrameElement | null {
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement && frames.has(active) ? active : null;
}

async function answer(method: string, args: unknown[]): Promise<unknown> {
  if (method === 'clipboard.readText') return window.saturn.clipboard.readText();
  if (method === 'clipboard.writeText') return window.saturn.clipboard.writeText(String(args[0]));
  if (method === 'clipboard.writeImage') return window.saturn.clipboard.writeImage(String(args[0]));
  if (method === 'projectImage') return window.saturn.documents.projectImage(String(args[0]));
  throw new Error(`Unknown request ${method}`);
}

export function ExtensionFrame({ html, title, testId, background = 'panel', onMessage, onSave, frameRef }: {
  html: string;
  title: string;
  testId?: string;
  background?: 'panel' | 'editor';
  onMessage: (message: unknown) => void;
  onSave?: () => void;
  frameRef?: { current: HTMLIFrameElement | null };
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ onMessage, onSave });
  latest.current = { onMessage, onSave };
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let registered: string | null = null;
    let cancelled = false;
    const bg = background === 'editor' ? '<style>body { background: var(--saturn-editor); }</style>' : '';
    const doc = `<!doctype html><html><head><meta charset="utf-8">${CSP}<style id="saturn-theme">:root { ${themeVariables()} }</style>${BASE_STYLE}${bg}${BRIDGE}</head><body>${html}</body></html>`;
    void window.saturn.pages.register(doc).then((u) => {
      registered = u;
      if (cancelled) void window.saturn.pages.release(u);
      else setUrl(u);
    });
    return () => {
      cancelled = true;
      if (registered) void window.saturn.pages.release(registered);
    };
  }, [html, background]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    frames.add(el);
    if (frameRef) frameRef.current = el;
    const theme = () => el.contentWindow?.postMessage({ saturnTheme: true, css: themeVariables() }, '*');
    const fromPage = (e: MessageEvent) => {
      if (e.source !== el.contentWindow || !e.data) return;
      const d = e.data as { saturnWebview?: boolean; message?: unknown; saturnKey?: string; saturnRequest?: boolean; id?: number; method?: string; args?: unknown[] };
      if (d.saturnWebview === true) latest.current.onMessage(d.message);
      else if (d.saturnKey === 'save') latest.current.onSave?.();
      else if (d.saturnRequest === true) {
        void answer(String(d.method), d.args ?? []).then(
          (result) => el.contentWindow?.postMessage({ saturnResponse: true, id: d.id, result }, '*'),
          (err: Error) => el.contentWindow?.postMessage({ saturnResponse: true, id: d.id, error: err.message }, '*'),
        );
      }
    };
    window.addEventListener('saturn:theme', theme);
    window.addEventListener('message', fromPage);
    return () => {
      frames.delete(el);
      window.removeEventListener('saturn:theme', theme);
      window.removeEventListener('message', fromPage);
    };
  }, []);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      src={url ?? undefined}
      class="w-full h-full border-0"
      data-testid={testId}
    />
  );
}

export function postToFrame(frame: HTMLIFrameElement | null, message: unknown): void {
  frame?.contentWindow?.postMessage({ saturnToWebview: true, message }, '*');
}

export function sendEdit(frame: HTMLIFrameElement, kind: 'undo' | 'redo'): void {
  frame.contentWindow?.postMessage({ saturnEdit: kind }, '*');
}
