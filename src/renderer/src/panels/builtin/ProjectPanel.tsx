import { useEffect, useState } from 'preact/hooks';
import type { DirEntry } from '@shared/types';
import { ContextMenu, TextInput, TreeRow, type MenuEntry } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

interface Row {
  entry: DirEntry;
  depth: number;
}

interface Creating {
  dir: string;
  templateId: string;
}

function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}

/** Expand all opens at most this many folders, and skips these (they're usually huge and generated). */
const EXPAND_LIMIT = 500;
const EXPAND_SKIP = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'build', 'out', '.venv', 'vendor', 'target']);

const REVEAL_LABEL = navigator.userAgent.includes('Mac') ? 'Reveal in Finder'
  : navigator.userAgent.includes('Windows') ? 'Show in Explorer' : 'Show in File Manager';

/** Inline name box shown in the tree while creating or renaming a file or folder (Enter confirms, Escape cancels). */
function NameRow({ depth, placeholder, initial = '', onSubmit, onCancel }: {
  depth: number;
  placeholder: string;
  initial?: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await onSubmit(name);
    } catch (e) {
      setError(String((e as Error).message).replace(/^.*Error: /, ''));
    }
  };
  return (
    <div style={{ paddingLeft: `${8 + depth * 14 + 18}px` }} class="pr-2 py-0.5">
      <TextInput
        class="w-full h-6"
        value={name}
        placeholder={placeholder}
        testId="new-file-name"
        autoFocus
        onInput={(v) => {
          setName(v);
          setError(null);
        }}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') onCancel();
          e.stopPropagation();
        }}
      />
      {error && <div class="text-accent pt-0.5" role="alert">{error}</div>}
    </div>
  );
}

interface MenuState {
  x: number;
  y: number;
  entry: DirEntry;
  /** "actions" is the right-click menu; "new" is the New file/folder menu it opens from New…. */
  mode: 'actions' | 'new';
}

/**
 * File explorer: the project folder as the root of a lazily-expanding tree. Right-click opens a
 * menu: New… (folders), Open (files), Rename…, Delete, copying the path and showing it in the OS.
 */
export function ProjectPanel() {
  const ws = useWorkspace();
  const root = ws.projectPath;
  ws.fileTemplates.changed.value; // re-render when languages add templates
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root]));
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = async (dir: string) => {
    try {
      const entries = await window.saturn.fs.readDir(dir);
      setChildren((prev) => new Map(prev).set(dir, entries));
    } catch {
      setChildren((prev) => {
        const next = new Map(prev);
        next.delete(dir);
        return next;
      });
    }
  };

  useEffect(() => {
    void load(root);
    return window.saturn.fs.onChanged((dir) => {
      setChildren((prev) => {
        if (prev.has(dir)) void load(dir);
        return prev;
      });
    });
  }, [root]);

  // The title bar's Expand all, Collapse all and Reload from disk.
  const request = ws.projectTreeRequest.value;
  useEffect(() => {
    if (!request) return;
    if (request.action === 'collapseAll') setExpanded(new Set([root]));
    if (request.action === 'refresh') {
      // Reload every folder that's been read, dropping ones that no longer exist.
      setChildren(new Map());
      for (const dir of new Set([root, ...expanded])) void load(dir);
    }
    if (request.action === 'expandAll') {
      void (async () => {
        const open = new Set([root]);
        const loaded = new Map(children);
        const queue = [root];
        while (queue.length && open.size < EXPAND_LIMIT) {
          const dir = queue.shift()!;
          const entries = loaded.get(dir) ?? await window.saturn.fs.readDir(dir).catch(() => []);
          loaded.set(dir, entries);
          for (const e of entries) {
            if (e.kind !== 'dir' || EXPAND_SKIP.has(e.name) || open.size >= EXPAND_LIMIT) continue;
            open.add(e.path);
            queue.push(e.path);
          }
        }
        setChildren(loaded);
        // Folders the limit stopped before reading stay closed (they'd look empty open).
        setExpanded(new Set([...open].filter((dir) => loaded.has(dir))));
        if (queue.length) ws.notice.value = { text: `Expanded the first ${EXPAND_LIMIT} folders`, kind: 'info' };
      })();
    }
  }, [request?.at]);

  const expand = (dir: string) => {
    setExpanded((prev) => new Set(prev).add(dir));
    if (!children.has(dir)) void load(dir);
  };

  const toggle = (path: string) => {
    if (expanded.has(path)) {
      const next = new Set(expanded);
      next.delete(path);
      setExpanded(next);
    } else expand(path);
  };

  const rootEntry: DirEntry = { name: ws.projectName, path: root, kind: 'dir' };
  const rows: Row[] = [{ entry: rootEntry, depth: 0 }];
  const walk = (dir: string, depth: number) => {
    for (const entry of children.get(dir) ?? []) {
      rows.push({ entry, depth });
      if (entry.kind === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  if (expanded.has(root)) walk(root, 1);

  const activate = (entry: DirEntry) => (entry.kind === 'dir' ? toggle(entry.path) : void ws.documents.open(entry.path));

  const onKeyDown = (e: KeyboardEvent) => {
    const index = rows.findIndex((r) => r.entry.path === selected);
    if (e.key === 'ArrowDown') setSelected(rows[Math.min(rows.length - 1, index + 1)]?.entry.path ?? null);
    else if (e.key === 'ArrowUp') setSelected(rows[Math.max(0, index - 1)]?.entry.path ?? null);
    else if (e.key === 'Enter' && index >= 0) activate(rows[index].entry);
    else return;
    e.preventDefault();
  };

  const openMenu = (e: MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(entry.path);
    setProblem(null);
    setMenu({ x: e.clientX, y: e.clientY, entry, mode: 'actions' });
  };

  const startCreating = (templateId: string) => {
    if (!menu) return;
    const dir = menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path);
    expand(dir);
    setCreating({ dir, templateId });
  };

  const report = (e: unknown) => setProblem(String((e as Error).message).replace(/^.*Error: /, ''));

  const runAction = (action: string) => {
    if (!menu) return;
    const { entry } = menu;
    // The menu has already closed itself; New… reopens it in the same place as the New menu.
    if (action === 'new') setMenu({ ...menu, mode: 'new' });
    if (action === 'open') void ws.documents.open(entry.path);
    if (action === 'rename') setRenaming(entry.path);
    if (action === 'delete') {
      void window.saturn.fs.trash(entry.path).then((done) => {
        if (!done) return;
        ws.documents.closeUnder(entry.path);
        void load(parentOf(entry.path));
      }, report);
    }
    if (action === 'copy-path') void navigator.clipboard.writeText(entry.path);
    if (action === 'copy-relative') void navigator.clipboard.writeText(entry.path === root ? '.' : entry.path.slice(root.length + 1));
    if (action === 'reveal') void window.saturn.fs.reveal(entry.path).catch(report);
  };

  const rename = async (name: string) => {
    if (!renaming) return;
    const from = renaming;
    const to = await window.saturn.fs.rename(from, name);
    setRenaming(null);
    ws.documents.moved(from, to);
    // Keep a renamed folder's expanded state and loaded children under the new path.
    if (expanded.has(from)) setExpanded((prev) => new Set([...prev].map((p) => (p === from ? to : p))));
    await load(parentOf(from));
    if (children.has(from)) void load(to);
    setSelected(to);
  };

  const actionItems = (entry: DirEntry): MenuEntry[] => {
    const isRoot = entry.path === root;
    return [
      ...(entry.kind === 'dir' ? [{ id: 'new', label: 'New…', testId: 'menu-new' }] : [{ id: 'open', label: 'Open', testId: 'menu-open' }]),
      ...(isRoot ? [] : [
        { separator: true as const },
        { id: 'rename', label: 'Rename…', testId: 'menu-rename' },
        { id: 'delete', label: 'Delete', testId: 'menu-delete' },
      ]),
      { separator: true },
      { id: 'copy-path', label: 'Copy Path', testId: 'menu-copy-path' },
      { id: 'copy-relative', label: 'Copy Relative Path', testId: 'menu-copy-relative' },
      { id: 'reveal', label: REVEAL_LABEL, testId: 'menu-reveal' },
    ];
  };

  const create = async (name: string) => {
    if (!creating) return;
    const path = await ws.createFromTemplate(creating.templateId, creating.dir, name);
    setCreating(null);
    await load(creating.dir);
    setSelected(path);
  };

  const depthOf = (dir: string) => (rows.find((r) => r.entry.path === dir)?.depth ?? 0) + 1;
  const template = creating ? ws.fileTemplates.get(creating.templateId) : undefined;

  return (
    <div
      role="tree"
      tabIndex={0}
      class="h-full overflow-auto py-1 outline-none"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.target === e.currentTarget && openMenu(e, rootEntry)}
      data-testid="project-tree"
    >
      {rows.map(({ entry, depth }) => (
        <div key={entry.path} onContextMenu={(e) => openMenu(e, entry)}>
          {renaming === entry.path ? (
            <NameRow depth={depth - 1} placeholder="Name" initial={entry.name} onSubmit={rename} onCancel={() => setRenaming(null)} />
          ) : (
            <TreeRow
              depth={depth}
              label={entry.name}
              expanded={entry.kind === 'dir' ? expanded.has(entry.path) : undefined}
              selected={entry.path === selected}
              onClick={() => {
                setSelected(entry.path);
                // One click opens a file or expands a folder.
                if (entry.kind === 'dir') toggle(entry.path);
                else void ws.documents.open(entry.path);
              }}
            />
          )}
          {creating && creating.dir === entry.path && (
            <NameRow
              depth={depthOf(entry.path)}
              placeholder={template?.placeholder ?? 'Name'}
              onSubmit={create}
              onCancel={() => setCreating(null)}
            />
          )}
        </div>
      ))}
      {problem && <div class="px-2 pt-1 text-accent" role="alert">{problem}</div>}
      {menu?.mode === 'actions' && (
        <ContextMenu at={menu} items={actionItems(menu.entry)} onPick={runAction} onClose={() => setMenu(null)} />
      )}
      {menu?.mode === 'new' && (
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            { group: 'New' },
            ...ws.fileTemplates.files().map((t) => ({ id: t.id, label: t.label, icon: t.icon, hint: t.extension, testId: `new-${t.id}` })),
            { separator: true },
            ...ws.fileTemplates.dirs().map((t) => ({ id: t.id, label: t.label, icon: t.icon, testId: `new-${t.id}` })),
          ]}
          onPick={startCreating}
        />
      )}
    </div>
  );
}
