import { useEffect, useRef, useState } from 'preact/hooks';
import { EditorView } from '@codemirror/view';
import { Button } from '@renderer/components';
import { createEditorState } from '@renderer/editor/codemirrorSetup';
import { errorText } from '@renderer/helpers';
import { useWorkspace } from './EditorWorkspace';

function Side({ title, text }: { title: string; text: string }) {
  return (
    <div class="flex-1 min-w-0 flex flex-col border-divider">
      <div class="px-2.5 h-7 flex items-center text-muted border-b border-divider shrink-0">{title}</div>
      <pre class="m-0 flex-1 overflow-auto p-2 font-mono text-[12px] leading-[1.6] bg-editor">{text}</pre>
    </div>
  );
}

export function MergeEditor({ path }: { path: string }) {
  const ws = useWorkspace();
  const relative = path.slice(ws.projectPath.length + 1);
  const host = useRef<HTMLDivElement>(null);
  const [sides, setSides] = useState<{ ours: string; theirs: string } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([window.saturn.git.conflictVersions(relative), window.saturn.fs.readFile(path)]).then(([versions, file]) => {
      setSides({ ours: versions.ours, theirs: versions.theirs });
      setText(file.kind === 'text' ? file.text.replace(/\r\n/g, '\n') : '');
    }, (e) => setProblem(errorText(e)));
  }, [path]);

  useEffect(() => {
    if (text === null || !host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: createEditorState(text, { onChange: setText, onCursor: () => undefined }),
    });
    return () => view.destroy();
  }, [text === null]);

  const unresolved = text !== null && /^(<<<<<<<|=======|>>>>>>>)/m.test(text);

  const save = async () => {
    if (text === null) return;
    setProblem(null);
    try {
      await window.saturn.fs.writeFile(path, text);
      await window.saturn.git.stage([relative]);
      await ws.documents.reloadClean();
      ws.documents.close(`diff:merge:${path}`);
    } catch (e) {
      setProblem(errorText(e));
    }
  };

  if (problem && !sides) return <p class="p-4 text-accent" role="alert">{problem}</p>;
  if (!sides) return <p class="p-4 text-muted">Loading…</p>;
  return (
    <div class="h-full flex flex-col" data-testid="merge-editor">
      <div class="flex-1 min-h-0 flex">
        <Side title="Current branch" text={sides.ours} />
        <div class="flex-1 min-w-0 flex flex-col border-x border-divider">
          <div class="px-2.5 h-7 flex items-center text-strong border-b border-divider shrink-0">Result</div>
          <div ref={host} class="flex-1 min-h-0 overflow-hidden" />
        </div>
        <Side title="Incoming" text={sides.theirs} />
      </div>
      <div class="flex items-center gap-2 px-2.5 py-1.5 border-t border-divider">
        <span class="flex-1 text-muted">{unresolved ? 'Resolve every conflict in the result, then save.' : 'No conflicts left.'}</span>
        {problem && <span class="text-accent" role="alert">{problem}</span>}
        <Button variant="primary" testId="merge-save" disabled={unresolved} onClick={() => void save()}>Save and mark resolved</Button>
      </div>
    </div>
  );
}
