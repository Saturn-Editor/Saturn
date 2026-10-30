import { useEffect, useState } from 'preact/hooks';
import type { DirEntry } from '@shared/types';
import { ContextMenu, SearchMenu, TextInput, TreeRow, type MenuEntry } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { isMac } from '@renderer/commands/keymap';
import { newPageId, NOTEBOOK_FILE, PAGE_EXTENSION } from '@shared/notebooks';
import { createPage, createSubpage, hasSubpages, isPagePath, pageId, subpageFolder } from '@renderer/notebooks/pages';
import { errorText, parentOf } from '@renderer/helpers';

interface Row {
  entry: DirEntry;
  depth: number;
  subpages?: string;
}

interface Creating {
  dir: string;
  templateId: string;
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
      setError(errorText(e));
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

interface Clip {
  path: string;
  mode: 'cut' | 'copy';
}

const MOD = isMac ? '⌘' : 'Ctrl+';

/**
 * File explorer: the project folder as the root of a lazily-expanding tree. Right-click opens a
 * menu: New… (folders), Open (files), Cut/Copy/Paste/Duplicate, Rename…, Delete, copying the path
 * and showing it in the OS. The same actions have keys while the tree has focus, and dragging a
 * row onto a folder moves it there (holding ⌥ / Ctrl copies instead).
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
  const [clip, setClip] = useState<Clip | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);

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
    const listed = children.get(dir) ?? [];
    const entries = ws.isNotebook
      ? [...listed].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1) || labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base' }))
      : listed;
    const folders = new Map(entries.filter((e) => e.kind === 'dir').map((e) => [e.name.toLowerCase(), e.path]));
    const pages = new Set(entries.filter((e) => isPagePath(e.path)).map((e) => pageId(e.path).toLowerCase()));
    for (const entry of entries) {
      if (ws.isNotebook && dir === root && entry.name === NOTEBOOK_FILE) continue;
      if (ws.isNotebook && entry.kind === 'dir' && pages.has(entry.name.toLowerCase())) continue;
      const subpages = ws.isNotebook && isPagePath(entry.path) ? folders.get(pageId(entry.path).toLowerCase()) : undefined;
      rows.push({ entry, depth, subpages });
      if (entry.kind === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1);
      if (subpages && expanded.has(subpages)) walk(subpages, depth + 1);
    }
  };
  if (expanded.has(root)) walk(root, 1);

  function isNotebookPage(entry: DirEntry) {
    return ws.isNotebook && entry.kind === 'file' && isPagePath(entry.path);
  }

  function labelOf(entry: DirEntry) {
    return isNotebookPage(entry) ? ws.titleOf(entry.path) : entry.name;
  }

  const activate = (entry: DirEntry) => (entry.kind === 'dir' ? toggle(entry.path) : void ws.documents.open(entry.path));

  const report = (e: unknown) => setProblem(errorText(e));

  const folderOf = (entry: DirEntry) => (entry.kind === 'dir' ? entry.path : parentOf(entry.path));

  const transfer = async (from: string, toDir: string, mode: 'cut' | 'copy') => {
    setProblem(null);
    try {
      const page = ws.isNotebook && isPagePath(from);
      const carry = page && (await hasSubpages(from));
      let to = mode === 'cut' ? await window.saturn.fs.move(from, toDir) : await window.saturn.fs.copy(from, toDir);
      if (page && mode === 'copy') to = await window.saturn.fs.rename(to, `${newPageId()}${PAGE_EXTENSION}`);
      if (carry) {
        const folderTo = mode === 'cut' ? await window.saturn.fs.move(subpageFolder(from), toDir) : await window.saturn.fs.copy(subpageFolder(from), toDir);
        if (folderTo !== subpageFolder(to)) await window.saturn.fs.rename(folderTo, pageId(to));
        if (mode === 'cut') ws.documents.moved(subpageFolder(from), subpageFolder(to));
      }
      if (mode === 'cut' && to !== from) {
        ws.documents.moved(from, to);
        if (expanded.has(from)) setExpanded((prev) => new Set([...prev].map((p) => (p === from ? to : p))));
        void load(parentOf(from));
      }
      expand(toDir);
      await load(toDir);
      setSelected(to);
    } catch (e) {
      report(e);
    }
  };

  const remove = (entry: DirEntry) => {
    // Deleting doesn't ask; Undo brings it back for 30 seconds (then it's in the system Trash).
    void (async () => {
      const paths = [entry.path, ...(isNotebookPage(entry) && (await hasSubpages(entry.path)) ? [subpageFolder(entry.path)] : [])];
      const ids: string[] = [];
      for (const path of paths) {
        ids.push(await window.saturn.fs.trash(path));
        ws.documents.closeUnder(path);
      }
      void load(parentOf(entry.path));
      ws.undo.value = {
        text: `Deleted ${labelOf(entry)}`,
        at: Date.now(),
        run: async () => {
          for (const id of ids) await window.saturn.fs.undoTrash(id);
          void load(parentOf(entry.path));
        },
      };
    })().catch(report);
  };

  const paste = (entry: DirEntry) => {
    if (!clip) return;
    void transfer(clip.path, folderOf(entry), clip.mode);
    if (clip.mode === 'cut') setClip(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const index = rows.findIndex((r) => r.entry.path === selected);
    const entry = index >= 0 ? rows[index].entry : null;
    const isRoot = entry?.path === root;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowDown') setSelected(rows[Math.min(rows.length - 1, index + 1)]?.entry.path ?? null);
    else if (e.key === 'ArrowUp') setSelected(rows[Math.max(0, index - 1)]?.entry.path ?? null);
    else if (e.key === 'Enter' && entry) activate(entry);
    else if (!entry) return;
    else if (mod && key === 'x' && !isRoot) setClip({ path: entry.path, mode: 'cut' });
    else if (mod && key === 'c' && !isRoot) setClip({ path: entry.path, mode: 'copy' });
    else if (mod && key === 'v' && clip) paste(entry);
    else if (mod && key === 'd' && !isRoot) void transfer(entry.path, parentOf(entry.path), 'copy');
    else if (e.key === 'F2' && !isRoot) setRenaming(entry.path);
    else if ((e.key === 'Delete' || (mod && e.key === 'Backspace') || (!isMac && e.key === 'Backspace')) && !isRoot) remove(entry);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const canDrop = (dir: string) => !!dragging && dir !== parentOf(dragging) && dir !== dragging && !dir.startsWith(dragging + '/') && !dir.startsWith(dragging + '\\');

  const dragProps = (entry: DirEntry) => {
    const dir = folderOf(entry);
    const copying = (e: DragEvent) => (isMac ? e.altKey : e.ctrlKey);
    return {
      onDragStart: entry.path === root ? undefined : (e: DragEvent) => {
        setDragging(entry.path);
        e.dataTransfer?.setData('text/plain', entry.path);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
      },
      onDragOver: (e: DragEvent) => {
        if (!dragging || (!canDrop(dir) && !copying(e))) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = copying(e) ? 'copy' : 'move';
        if (dropDir !== dir) setDropDir(dir);
      },
      onDragLeave: () => setDropDir((d) => (d === dir ? null : d)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const from = dragging;
        setDragging(null);
        setDropDir(null);
        if (from) void transfer(from, dir, copying(e) ? 'copy' : 'cut');
      },
    };
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

  const runAction = (action: string) => {
    if (!menu) return;
    const { entry } = menu;
    // The menu has already closed itself; New… reopens it in the same place as the New menu.
    if (action === 'new') setMenu({ ...menu, mode: 'new' });
    if (action === 'open') void ws.documents.open(entry.path);
    if (action === 'subpage') {
      void createSubpage(entry.path).then(async (page) => {
        const folder = parentOf(page.path);
        await load(parentOf(entry.path));
        expand(folder);
        setSelected(page.path);
        void ws.documents.open(page.path);
      }, report);
    }
    if (action === 'cut') setClip({ path: entry.path, mode: 'cut' });
    if (action === 'copy') setClip({ path: entry.path, mode: 'copy' });
    if (action === 'paste') paste(entry);
    if (action === 'duplicate') void transfer(entry.path, parentOf(entry.path), 'copy');
    if (action === 'rename') setRenaming(entry.path);
    if (action === 'delete') remove(entry);
    if (action === 'copy-path') void navigator.clipboard.writeText(entry.path);
    if (action === 'copy-relative') void navigator.clipboard.writeText(entry.path === root ? '.' : entry.path.slice(root.length + 1));
    if (action === 'reveal') void window.saturn.fs.reveal(entry.path).catch(report);
  };

  const rename = async (name: string) => {
    if (!renaming) return;
    const from = renaming;
    if (ws.isNotebook && isPagePath(from)) {
      setRenaming(null);
      await ws.renamePage(from, name);
      return;
    }
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
      ...(ws.isNotebook && isPagePath(entry.path) ? [{ id: 'subpage', label: 'New Sub-page', testId: 'menu-subpage' }] : []),
      { separator: true as const },
      ...(isRoot ? [] : [
        { id: 'cut', label: 'Cut', hint: `${MOD}X`, testId: 'menu-cut' },
        { id: 'copy', label: 'Copy', hint: `${MOD}C`, testId: 'menu-copy' },
      ]),
      ...(clip ? [{ id: 'paste', label: 'Paste', hint: `${MOD}V`, testId: 'menu-paste' }] : []),
      ...(isRoot ? [] : [
        { id: 'duplicate', label: 'Duplicate', hint: `${MOD}D`, testId: 'menu-duplicate' },
        { separator: true as const },
        { id: 'rename', label: 'Rename…', hint: 'F2', testId: 'menu-rename' },
        { id: 'delete', label: 'Delete', hint: isMac ? '⌘⌫' : 'Delete', testId: 'menu-delete' },
      ]),
      { separator: true },
      { id: 'copy-path', label: 'Copy Path', testId: 'menu-copy-path' },
      { id: 'copy-relative', label: 'Copy Relative Path', testId: 'menu-copy-relative' },
      { id: 'reveal', label: REVEAL_LABEL, testId: 'menu-reveal' },
    ];
  };

  const create = async (name: string) => {
    if (!creating) return;
    const path = creating.templateId === 'notebook.page'
      ? (await createPage(creating.dir, name)).path
      : await ws.createFromTemplate(creating.templateId, creating.dir, name);
    if (creating.templateId === 'notebook.page') {
      await ws.refreshTitles();
      void ws.documents.open(path);
    }
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
      onDragEnd={() => {
        setDragging(null);
        setDropDir(null);
      }}
      onContextMenu={(e) => e.target === e.currentTarget && openMenu(e, rootEntry)}
      data-testid="project-tree"
    >
      {rows.map(({ entry, depth, subpages }) => (
        <div key={entry.path} onContextMenu={(e) => openMenu(e, entry)}>
          {renaming === entry.path ? (
            <NameRow depth={depth - 1} placeholder="Name" initial={labelOf(entry)} onSubmit={rename} onCancel={() => setRenaming(null)} />
          ) : (
            <TreeRow
              depth={depth}
              label={labelOf(entry)}
              expanded={entry.kind === 'dir' ? expanded.has(entry.path) : subpages ? expanded.has(subpages) : undefined}
              onToggle={subpages ? () => toggle(subpages) : undefined}
              selected={entry.path === selected}
              dimmed={clip?.mode === 'cut' && clip.path === entry.path}
              dropTarget={dropDir === entry.path}
              {...dragProps(entry)}
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
        <SearchMenu
          at={menu}
          title="New"
          placeholder="Search file types"
          recentKey={`saturn:recent-templates:${ws.noun}`}
          testId="new-menu"
          onClose={() => setMenu(null)}
          items={[
            ...ws.fileTemplates.files().map((t) => ({ id: t.id, label: t.label, icon: t.icon, hint: t.extension, testId: `new-${t.id}` })),
            ...ws.fileTemplates.dirs().map((t) => ({ id: t.id, label: t.label, icon: t.icon, testId: `new-${t.id}` })),
          ]}
          onPick={startCreating}
        />
      )}
    </div>
  );
}
