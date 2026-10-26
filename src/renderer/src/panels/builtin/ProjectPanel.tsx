import { useEffect, useState } from 'preact/hooks';
import type { DirEntry } from '@shared/types';
import { Menu, TextInput, TreeRow } from '@renderer/components';
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

/** Inline name box shown in the tree while creating a file or folder (Enter creates, Escape cancels). */
function NameRow({ depth, placeholder, onSubmit, onCancel }: {
  depth: number;
  placeholder: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
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

/** File explorer: the project folder as the root of a lazily-expanding tree, with a right-click New menu. */
export function ProjectPanel() {
  const ws = useWorkspace();
  const root = ws.projectPath;
  ws.fileTemplates.changed.value; // re-render when languages add templates
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root]));
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; dir: string } | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);

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

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

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
    setSelected(entry.path);
    setMenu({ x: e.clientX, y: e.clientY, dir: entry.kind === 'dir' ? entry.path : parentOf(entry.path) });
  };

  const startCreating = (templateId: string) => {
    if (!menu) return;
    expand(menu.dir);
    setCreating({ dir: menu.dir, templateId });
    setMenu(null);
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
          <TreeRow
            depth={depth}
            label={entry.name}
            expanded={entry.kind === 'dir' ? expanded.has(entry.path) : undefined}
            selected={entry.path === selected}
            onClick={() => {
              setSelected(entry.path);
              if (entry.kind === 'dir') toggle(entry.path);
            }}
            onDoubleClick={() => entry.kind === 'file' && void ws.documents.open(entry.path)}
          />
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
      {menu && (
        <Menu
          at={menu}
          class="w-52"
          selectedIndex={-1}
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
