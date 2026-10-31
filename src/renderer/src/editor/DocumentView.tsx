import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@renderer/components';
import { ExtensionFrame, postToFrame } from '@renderer/modules/ExtensionFrame';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

export function shouldPostReload(previous: string, next: string, lastSent: string | null): boolean {
  return next !== previous && next !== lastSent;
}

export function DocumentView({ path, documentId, text }: { path: string; documentId: string; text: string }) {
  const ws = useWorkspace();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const previous = useRef(text);

  useEffect(() => {
    setFailed(false);
    void window.saturn.documents.html(documentId, path, text).then(setHtml, () => setFailed(true));
  }, [documentId, path]);

  useEffect(() => window.saturn.documents.onPost((p, message) => p === path && postToFrame(frame.current, message)), [path]);

  useEffect(() => {
    if (shouldPostReload(previous.current, text, ws.documentSent.get(path) ?? null)) postToFrame(frame.current, { type: 'reload', text });
    previous.current = text;
  }, [text]);

  if (failed) {
    return (
      <div class="flex-1 flex flex-col items-center justify-center gap-2 text-muted" data-testid="document-unavailable">
        <span>This document's extension isn't available.</span>
        <Button onClick={() => ws.documents.openAsText(path)}>Open as text</Button>
      </div>
    );
  }
  if (html === null) return <div class="flex-1 flex items-center justify-center text-muted">Loading…</div>;
  return (
    <div class="flex-1 min-w-0">
      <ExtensionFrame
        html={html}
        title={path}
        testId="document-view"
        background="editor"
        frameRef={frame}
        onMessage={(message) => void window.saturn.documents.message(documentId, path, message).catch((e) => console.error(`Document ${path}:`, e))}
        onSave={() => void ws.documents.save(path)}
      />
    </div>
  );
}
