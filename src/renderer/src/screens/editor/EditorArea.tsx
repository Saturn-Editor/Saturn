import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Button, CodeIcon, ContextMenu, IconButton, MoreIcon, NoticesIcon, PreviewIcon, SplitIcon, TabMenu } from '@renderer/components';
import { diagnosticCounts, onDiagnosticCounts } from '@renderer/modules/languageServer';
import { PreviewPane } from '@renderer/preview/PreviewPane';
import type { ViewMode } from '@renderer/preview/PreviewRegistry';
import { createEditorState, cursorLabel, languageCompartment, runEditorCommand } from '@renderer/editor/codemirrorSetup';
import { shortcutFor } from '@renderer/commands/keymap';
import type { MenuEntry } from '@renderer/components';
import { breakpoints, setExecutionLine } from '@renderer/editor/breakpoints';
import { refreshHighlighting } from '@renderer/modules/textmate';
import type { InfoDoc } from '@renderer/editor/EditorDocuments';
import { DiffView } from './DiffView';
import { useWorkspace } from './EditorWorkspace';

/** Floating at the editor's top right while the open file has errors or warnings; opens the Notices panel. */
function NoticeCount() {
  const ws = useWorkspace();
  const [, setVersion] = useState(0);
  useEffect(() => onDiagnosticCounts(() => setVersion((n) => n + 1)), []);
  const path = ws.documents.activePath.value;
  const { errors, warnings } = path ? diagnosticCounts(path) : { errors: 0, warnings: 0 };
  if (!errors && !warnings) return null;
  return (
    <button
      type="button"
      data-testid="notice-count"
      title="Show errors and warnings"
      onClick={() => ws.layout.show('notices')}
      class="absolute z-10 top-10 right-4 flex items-center gap-1.5 h-6 px-2 bg-raised border border-border shadow-md shadow-black/30 hover:bg-hover"
    >
      <NoticesIcon class={`size-3.5 ${errors ? 'text-accent' : 'text-muted'}`} />
      {errors > 0 && <span class="text-accent font-semibold">{errors}</span>}
      {warnings > 0 && <span class="text-muted">{warnings}</span>}
    </button>
  );
}

/**
 * The "…" at the right of the file tabs: Close All, Close Others and Split Right / Close Split. Files with unsaved changes stay
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
            { id: 'split', label: ws.documents.split.value ? 'Close Split' : 'Split Right', testId: 'tabs-split' },
          ]}
          onPick={(id) => {
            if (id === 'split') return ws.documents.toggleSplit();
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
  if (info.reason === 'diff') return <DiffView diff={info.diff} workingPath={info.workingPath} />;
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

/**
 * The editor's right-click menu: language actions (those the file's language server offers), then
 * breakpoints and the clipboard. Each shows its shortcut in the current keymap.
 */
function EditorContextMenu({ view, path, at, onClose }: { view: EditorView; path: string; at: { x: number; y: number }; onClose: () => void }) {
  const ws = useWorkspace();
  const features = ws.modules.languageFor(path)?.features ?? [];
  const item = (id: string, label: string) => ({ id, label, hint: shortcutFor(id) ?? undefined, testId: `editor-menu-${id.split('.')[1]}` });
  const language = [
    ...(features.includes('definition') ? [item('editor.gotoDefinition', 'Go to Definition')] : []),
    ...(features.includes('references') ? [item('editor.findReferences', 'Find Usages')] : []),
    ...(features.includes('rename') ? [item('editor.rename', 'Rename Symbol')] : []),
    ...(features.includes('formatting') ? [item('editor.formatDocument', 'Format Document')] : []),
  ];
  const items: MenuEntry[] = [
    ...language,
    ...(language.length ? [{ separator: true } as const] : []),
    item('editor.toggleBreakpoint', 'Toggle Breakpoint'),
    { separator: true },
    { id: 'cut', label: 'Cut' },
    { id: 'copy', label: 'Copy' },
    { id: 'paste', label: 'Paste' },
  ];
  const clipboard = async (id: string) => {
    const { from, to } = view.state.selection.main;
    if (id === 'paste') {
      const text = await navigator.clipboard.readText();
      view.dispatch(view.state.replaceSelection(text));
    } else if (from !== to) {
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
      if (id === 'cut') view.dispatch({ changes: { from, to }, selection: { anchor: from } });
    }
  };
  return (
    <ContextMenu
      at={at}
      class="w-60"
      items={items}
      onClose={onClose}
      onPick={(id) => {
        view.focus();
        if (id.startsWith('editor.')) runEditorCommand(id, view);
        else void clipboard(id).catch(() => undefined);
      }}
    />
  );
}

/** Makes an editor show `text` by replacing only the part that differs (so the cursor and scroll stay put). */
function syncText(view: EditorView, text: string): void {
  const current = view.state.doc.toString();
  if (current === text) return;
  let start = 0;
  while (start < current.length && start < text.length && current[start] === text[start]) start++;
  let end = 0;
  while (end < current.length - start && end < text.length - start && current[current.length - 1 - end] === text[text.length - 1 - end]) end++;
  view.dispatch({ changes: { from: start, to: current.length - end, insert: text.slice(start, text.length - end) } });
}

/**
 * One side of the editor: file tabs plus one CodeMirror view whose state is swapped per open file.
 * With a split there are two; both list the same open files, and each shows its own.
 */
function EditorPane({ group }: { group: 0 | 1 }) {
  const ws = useWorkspace();
  const { documents, debug } = ws;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const shownPath = useRef<string | null>(null);
  const [modes, setModes] = useState<Record<string, ViewMode>>({});
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const split = documents.split.value;
  const focused = documents.focused.value === group;
  const activePath = documents.pathFor(group);
  const activeDoc = documents.docs.value.find((d) => d.path === activePath) ?? null;
  const activeInfo = documents.infos.value.find((i) => i.path === activePath) ?? null;

  useEffect(() => {
    const v = new EditorView({ parent: host.current! });
    view.current = v;
    const recolour = () => refreshHighlighting(v);
    // Clicking or typing in this side makes it the focused one (whose file Save, Close Tab… act on).
    const onFocus = () => {
      documents.focus(group);
      ws.activeView = v;
    };
    v.contentDOM.addEventListener('focus', onFocus);
    window.addEventListener('saturn:theme', recolour);
    return () => {
      window.removeEventListener('saturn:theme', recolour);
      if (ws.activeView === v) ws.activeView = null;
      v.destroy();
    };
  }, []);

  useEffect(() => {
    if (focused && view.current) ws.activeView = view.current;
  }, [focused]);

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
    const state = cached ?? createEditorState(activeDoc.text, {
      onChange: (text) => documents.setText(path, text),
      onCursor: (label) => (ws.cursor.value = label),
    }, breakpoints(debug.breakpoints.value[path] ?? [], (lines) => debug.setBreakpoints(path, lines)));
    v.setState(state);
    // The file may have changed while another side or a rename edited it.
    syncText(v, activeDoc.text);
    ws.cursor.value = cursorLabel(v.state);
    if (focused) v.focus();
    if (!cached) {
      // Language support (highlighting, completion) loads asynchronously, then slots in.
      void ws.modules.editorExtensions(path).then((extensions) => {
        if (shownPath.current === path && extensions.length) v.dispatch({ effects: languageCompartment.reconfigure(extensions) });
      });
    }
  }, [activeDoc?.path, documents.docs.value.length, modulesVersion]);

  // Edits made elsewhere (the other side of a split, a rename) show here too.
  useEffect(() => {
    const v = view.current;
    if (v && activeDoc && shownPath.current === activeDoc.path) syncText(v, activeDoc.text);
  }, [activeDoc?.text]);

  // The paused program's line, while it's in this file.
  const frame = debug.frame.value;
  useEffect(() => {
    const v = view.current;
    if (!v || !activeDoc) return;
    const line = frame && frame.path === activeDoc.path ? frame.line : null;
    v.dispatch({ effects: setExecutionLine.of(line) });
  }, [frame, activeDoc?.path]);

  // Jump to a requested line (and column) once its file is the one showing on the focused side.
  const reveal = documents.reveal.value;
  useEffect(() => {
    const v = view.current;
    if (!v || !focused || !reveal || reveal.path !== shownPath.current) return;
    const line = v.state.doc.line(Math.min(Math.max(1, reveal.line), v.state.doc.lines));
    const pos = line.from + Math.min(Math.max(0, (reveal.column ?? 1) - 1), line.length);
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    v.focus();
    documents.reveal.value = null;
  }, [reveal, activeDoc?.path, focused]);

  const tabs = [
    ...documents.docs.value.map((d) => ({ id: d.path, label: d.name, dirty: d.dirty, closable: true })),
    ...documents.infos.value.map((i) => ({ id: i.path, label: i.name, closable: true })),
  ];

  ws.previews.changed.value; // re-render when languages add or remove previews
  const provider = activeDoc ? ws.previews.for(activeDoc.path) : undefined;
  // The view picked for this tab, else the user's default for its file type, else the language's.
  const mode: ViewMode = provider && activeDoc ? (modes[activeDoc.path] ?? ws.defaultViews.value[provider.id] ?? provider.defaultView ?? 'code') : 'code';
  const setMode = (m: ViewMode) => activeDoc && setModes({ ...modes, [activeDoc.path]: m });

  const modeButtons = provider && (
    <>
      <IconButton icon={<CodeIcon />} label="Code only" active={mode === 'code'} onClick={() => setMode('code')} />
      <IconButton icon={<SplitIcon />} label="Code and preview" active={mode === 'split'} onClick={() => setMode('split')} />
      <IconButton icon={<PreviewIcon />} label="Preview only" active={mode === 'preview'} onClick={() => setMode('preview')} />
    </>
  );

  return (
    <div
      class={`flex-1 flex flex-col min-w-0 min-h-0 ${group === 1 ? 'border-l border-divider' : ''}`}
      data-testid={`editor-pane-${group}`}
      onPointerDown={() => documents.focus(group)}
    >
      {tabs.length > 0 && (
        <TabMenu
          tabs={tabs}
          active={activePath}
          onSelect={(p) => {
            documents.focus(group);
            documents.activePath.value = p;
          }}
          onClose={(p) => documents.close(p)}
          trailing={<>{modeButtons}{(group === 1 || !split) && <TabsMenu />}</>}
        />
      )}
      <div class="relative flex-1 min-h-0 flex">
        <div
          class={`relative min-w-0 ${activeDoc && mode !== 'preview' ? 'flex-1' : 'hidden'}`}
          onContextMenu={(e) => {
            const v = view.current;
            if (!v) return;
            e.preventDefault();
            // Right-clicking outside the selection moves the cursor there first, so the actions apply to what was clicked.
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            const { from, to } = v.state.selection.main;
            if (pos !== null && (pos < from || pos > to)) v.dispatch({ selection: { anchor: pos } });
            setMenuAt({ x: e.clientX, y: e.clientY });
          }}
        >
          <div ref={host} class="absolute inset-0" data-testid={group === 0 ? 'code-editor' : 'code-editor-2'} />
        </div>
        {menuAt && view.current && activeDoc && <EditorContextMenu view={view.current} path={activeDoc.path} at={menuAt} onClose={() => setMenuAt(null)} />}
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

/** The editor: one pane, or two side by side after Split Right. */
export function EditorArea() {
  const ws = useWorkspace();
  return (
    <div class="relative flex-1 flex min-w-0 min-h-0 bg-editor">
      <NoticeCount />
      <EditorPane group={0} />
      {ws.documents.split.value && <EditorPane group={1} />}
    </div>
  );
}
