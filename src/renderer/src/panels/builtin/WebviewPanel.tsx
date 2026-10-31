import { useEffect, useRef, useState } from 'preact/hooks';
import { errorText } from '@renderer/helpers';
import { ExtensionFrame, postToFrame } from '@renderer/modules/ExtensionFrame';

/**
 * A module's webview panel: its HTML in a sandboxed frame (scripts allowed, but no access to Saturn,
 * Node or the network), with messages passed both ways. Theme changes update colours in place; the
 * page reloads only when the module asks.
 */
export function WebviewPanel({ panelId }: { panelId: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setProblem(null);
    void window.saturn.modules.webviewHtml(panelId).then(setHtml, (e) => setProblem(errorText(e)));
  }, [panelId, version]);

  useEffect(() => {
    const offRefresh = window.saturn.modules.onWebviewRefresh((id) => id === panelId && setVersion((v) => v + 1));
    const offPost = window.saturn.modules.onWebviewPost((id, message) => id === panelId && postToFrame(frame.current, message));
    return () => {
      offRefresh();
      offPost();
    };
  }, [panelId]);

  if (problem) return <p class="px-3 text-accent" role="alert">{problem}</p>;
  if (html === null) return <div class="h-full flex items-center justify-center text-muted">Loading…</div>;
  return (
    <ExtensionFrame
      key={version}
      html={html}
      title={panelId}
      testId={`webview-${panelId}`}
      frameRef={frame}
      onMessage={(message) => void window.saturn.modules.webviewMessage(panelId, message).catch((err) => console.error(`Webview ${panelId}:`, err))}
    />
  );
}
