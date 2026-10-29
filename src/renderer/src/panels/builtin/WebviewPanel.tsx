import { useEffect, useRef, useState } from 'preact/hooks';
import { themeVariables } from '@renderer/theme/ThemeApplier';
import { errorText } from '@renderer/helpers';

/**
 * Inside the page: `saturn.postMessage(message)` reaches the module's onMessage, and
 * `saturn.onMessage(callback)` hears the module's postMessage. Messages go through the parent window.
 */
const BRIDGE = `<script>
(() => {
  const listeners = [];
  window.saturn = {
    postMessage: (message) => parent.postMessage({ saturnWebview: true, message }, '*'),
    onMessage: (callback) => { listeners.push(callback); },
  };
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.saturnToWebview !== true) return;
    for (const l of listeners) l(e.data.message);
  });
})();
</script>`;

/** No network, frames or plugins; only the module's own inline scripts and styles, and images from data:/https:. */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:">`;

function themeStyle(): string {
  return `<style>:root { ${themeVariables()} } html, body { margin: 0; height: 100%; } body { font: 12px/1.5 system-ui, sans-serif;
    background: var(--saturn-panel); color: var(--saturn-text); } a { color: var(--saturn-accent); }</style>`;
}

/**
 * A module's webview panel: its HTML in a sandboxed frame (scripts allowed, but no access to Saturn,
 * Node or the network), with messages passed both ways. Reloads when the theme changes or the module
 * asks; the page should keep any state it needs in the module.
 */
export function WebviewPanel({ panelId }: { panelId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setProblem(null);
    void window.saturn.modules.webviewHtml(panelId).then(setHtml, (e) => setProblem(errorText(e)));
  }, [panelId, version]);

  useEffect(() => {
    const reload = () => setVersion((v) => v + 1);
    const offRefresh = window.saturn.modules.onWebviewRefresh((id) => id === panelId && reload());
    window.addEventListener('saturn:theme', reload);
    // From the module to the page.
    const offPost = window.saturn.modules.onWebviewPost((id, message) => {
      if (id === panelId) frame.current?.contentWindow?.postMessage({ saturnToWebview: true, message }, '*');
    });
    // From the page to the module (only this panel's frame is listened to).
    const fromPage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || e.data.saturnWebview !== true) return;
      void window.saturn.modules.webviewMessage(panelId, e.data.message).catch((err) => console.error(`Webview ${panelId}:`, err));
    };
    window.addEventListener('message', fromPage);
    return () => {
      offRefresh();
      offPost();
      window.removeEventListener('saturn:theme', reload);
      window.removeEventListener('message', fromPage);
    };
  }, [panelId]);

  if (problem) return <p class="px-3 text-accent" role="alert">{problem}</p>;
  if (html === null) return <div class="h-full flex items-center justify-center text-muted">Loading…</div>;
  return (
    <iframe
      ref={frame}
      key={version}
      title={panelId}
      sandbox="allow-scripts"
      srcdoc={`<!doctype html><html><head><meta charset="utf-8">${CSP}${themeStyle()}${BRIDGE}</head><body>${html}</body></html>`}
      class="w-full h-full border-0"
      data-testid={`webview-${panelId}`}
    />
  );
}
