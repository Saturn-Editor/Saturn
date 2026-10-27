import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Button, CodeIcon, ContextMenu, IconButton, MoreIcon, NoticesIcon, PreviewIcon, SplitIcon, TabMenu } from '@renderer/components';
import { useProjectDiagnostics } from '@renderer/panels/builtin/NoticesPanel';
import { PreviewPane } from '@renderer/preview/PreviewPane';
import type { ViewMode } from '@renderer/preview/PreviewRegistry';
import { createEditorState, cursorLabel, languageCompartment } from '@renderer/editor/codemirrorSetup';
import { refreshHighlighting } from '@renderer/modules/textmate';
import type { InfoDoc } from '@renderer/editor/EditorDocuments';
import { useWorkspace } from './EditorWorkspace';

/** Floating at the editor's top right while the project has errors or warnings; opens the Notices panel. */
function NoticeCount() {
  const ws = useWorkspace();
  const { errors, warnings } = useProjectDiagnostics();
  if (!errors && !warnings) return null;
  return (
    <button
      type="button"
      data-testid="notice-count"
      title="Show errors and warnings"
      onClick={() => ws.layout.show('notices')}
      class="absolute z-10 top-2 right-4 flex items-center gap-1.5 h-6 px-2 bg-raised border border-border shadow-md shadow-black/30 hover:bg-hover"
    >
      <NoticesIcon class={`size-3.5 ${errors ? 'text-accent' : 'text-muted'}`} />
      {errors > 0 && <span class="text-accent font-semibold">{errors}</span>}
      {warnings > 0 && <span class="text-muted">{warnings}</span>}
    </button>
  );
}

/**
 * The "…" at the right of the file tabs: Close All and Close Others. Files with unsaved changes stay
 * open (closing a tab doesn't ask to save), and the status bar says how many were kept.
 */
function TabsMenu() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const closeWhere = (keep: (path: string) => boolean) => {
    const docs = ws.documents;
    let kept = 0;
    for (const path of docs.tabOrder()) {
      if (keep(path)) continue;
      if (docs.isDirty(path)) kept++;
      else docs.close(path);
    }
    if (kept) ws.notice.value = { text: `Kept ${kept} file${kept === 1 ? '' : 's'} with unsaved changes open`, kind: 'info' };
  };
  return (
    <span ref={anchor} class="relative">
      <IconButton icon={<MoreIcon />} label="Tab actions" data-testid="tabs-menu" onClick={() => setOpen(!open)} />
      {open && (
        <ContextMenu
          class="top-8 right-0 w-56"
          anchor={anchor}
          items={[
            { id: 'all', label: 'Close All', testId: 'tabs-close-all' },
            { id: 'others', label: 'Close Others', testId: 'tabs-close-others' },
          ]}
          onPick={(id) => {
            const active = ws.documents.activePath.value;
            closeWhere(id === 'all' ? () => false : (p) => p === active);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

function InfoView({ info }: { info: InfoDoc }) {
  const ws = useWorkspace();
  const megabytes = ((info.bytes ?? 0) / 1024 / 1024).toFixed(1);
  return (
    <div class="h-full flex flex-col items-center justify-center gap-3 bg-editor text-muted" data-testid="file-info">
      {info.reason === 'binary' ? (
        <p>This file can't be opened as text.</p>
      ) : (
        <>
          <p>This file is {megabytes} MB. Open anyway?</p>
          <Button variant="primary" onClick={() => void ws.documents.open(info.path, { force: true })}>Open</Button>
        </>
      )}
    </div>
  );
}

/** File tabs plus one CodeMirror view whose state is swapped per open file. */
export function EditorArea() {
  const ws = useWorkspace();
  const { documents } = ws;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const shownPath = useRef<string | null>(null);
  const [modes, setModes] = useState<Record<string, ViewMode>>({});

  const activePath = documents.activePath.value;
  const activeDoc = documents.active.value;
  const activeInfo = documents.infos.value.find((i) => i.path === activePath) ?? null;

  useEffect(() => {
    view.current = new EditorView({ parent: host.current! });
    const recolour = () => view.current && refreshHighlighting(view.current);
    window.addEventListener('saturn:theme', recolour);
    return () => {
      window.removeEventListener('saturn:theme', recolour);
      view.current?.destroy();
    };
  }, []);

  // Languages changed: drop cached editor states so every file picks up its new language support.
  const modulesVersion = ws.modules.version.value;
  const seenVersion = useRef(modulesVersion);
  if (seenVersion.current !== modulesVersion) {
    seenVersion.current = modulesVersion;
    states.current.clear();
    shownPath.current = null;
  }

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (shownPath.current) states.current.set(shownPath.current, v.state);
    // Forget states for files that were closed.
    for (const path of states.current.keys()) if (!documents.docs.value.some((d) => d.path === path)) states.current.delete(path);
    shownPath.current = activeDoc?.path ?? null;
    if (!activeDoc) return;
    const path = activeDoc.path;
    const cached = states.current.get(path);
    const state = cached ?? createEditorState(documents.docs.value.find((d) => d.path === path)?.text ?? '', {
      onChange: (text) => documents.setText(path, text),
      onCursor: (label) => (ws.cursor.value = label),
    });
    v.setState(state);
    ws.cursor.value = cursorLabel(state);
    v.focus();
    if (!cached) {
      // Language support (highlighting, completion) loads asynchronously, then slots in.
      void ws.modules.editorExtensions(path).then((extensions) => {
        if (shownPath.current === path && extensions.length) v.dispatch({ effects: languageCompartment.reconfigure(extensions) });
      });
    }
  }, [activeDoc?.path, documents.docs.value.length, modulesVersion]);

  // Jump to a requested line (and column) once its file is the one showing.
  const reveal = documents.reveal.value;
  useEffect(() => {
    const v = view.current;
    if (!v || !reveal || reveal.path !== shownPath.current) return;
    const line = v.state.doc.line(Math.min(Math.max(1, reveal.line), v.state.doc.lines));
    const pos = line.from + Math.min(Math.max(0, (reveal.column ?? 1) - 1), line.length);
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    v.focus();
    documents.reveal.value = null;
  }, [reveal, activeDoc?.path]);

  const tabs = [
    ...documents.docs.value.map((d) => ({ id: d.path, label: d.name, dirty: d.dirty, closable: true })),
    ...documents.infos.value.map((i) => ({ id: i.path, label: i.name, closable: true })),
  ];

  ws.previews.changed.value; // re-render when languages add or remove previews
  const provider = activeDoc ? ws.previews.for(activeDoc.path) : undefined;
  const mode: ViewMode = provider && activeDoc ? (modes[activeDoc.path] ?? 'code') : 'code';
  const setMode = (m: ViewMode) => activeDoc && setModes({ ...modes, [activeDoc.path]: m });

  const modeButtons = provider && (
    <>
      <IconButton icon={<CodeIcon />} label="Code only" active={mode === 'code'} onClick={() => setMode('code')} />
      <IconButton icon={<SplitIcon />} label="Code and preview" active={mode === 'split'} onClick={() => setMode('split')} />
      <IconButton icon={<PreviewIcon />} label="Preview only" active={mode === 'preview'} onClick={() => setMode('preview')} />
    </>
  );

  return (
    <div class="flex-1 flex flex-col min-w-0 min-h-0 bg-editor">
      {tabs.length > 0 && (
        <TabMenu
          tabs={tabs}
          active={activePath}
          onSelect={(p) => (documents.activePath.value = p)}
          onClose={(p) => documents.close(p)}
          trailing={<>{modeButtons}<TabsMenu /></>}
        />
      )}
      <div class="relative flex-1 min-h-0 flex">
        <NoticeCount />
        <div class={`relative min-w-0 ${activeDoc && mode !== 'preview' ? 'flex-1' : 'hidden'}`}>
          <div ref={host} class="absolute inset-0" data-testid="code-editor" />
        </div>
        {provider && activeDoc && mode !== 'code' && (
          <div class={`flex-1 min-w-0 ${mode === 'split' ? 'border-l border-divider' : ''}`}>
            <PreviewPane provider={provider} text={activeDoc.text} path={activeDoc.path} projectPath={ws.projectPath} />
          </div>
        )}
        {activeInfo && <div class="flex-1"><InfoView info={activeInfo} /></div>}
        {!activeDoc && !activeInfo && (
          <div class="flex-1 flex items-center justify-center text-muted">Open a file from the Project panel.</div>
        )}
      </div>
    </div>
  );
}
