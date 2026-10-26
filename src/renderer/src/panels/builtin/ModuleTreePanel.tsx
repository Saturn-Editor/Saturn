import { useEffect, useState } from 'preact/hooks';
import type { TreeItem } from '@shared/modules';
import { TreeRow } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

const ROOT = '\0root';

/** A tree panel whose items come from a language module (via the extension host). */
export function ModuleTreePanel({ panelId }: { panelId: string }) {
  const ws = useWorkspace();
  const [children, setChildren] = useState<Map<string, TreeItem[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (parentId: string | null) => {
    try {
      const items = await window.saturn.modules.treeChildren(panelId, parentId);
      setChildren((prev) => new Map(prev).set(parentId ?? ROOT, items));
      setError(null);
    } catch (e) {
      setError(String((e as Error).message).replace(/^.*Error: /, ''));
    }
  };

  useEffect(() => {
    void load(null);
    return window.saturn.modules.onTreeRefresh((id) => {
      if (id !== panelId) return;
      setChildren(new Map());
      void load(null);
      expanded.forEach((p) => void load(p));
    });
  }, [panelId]);

  const toggle = (item: TreeItem) => {
    const next = new Set(expanded);
    if (next.has(item.id)) next.delete(item.id);
    else {
      next.add(item.id);
      if (!children.has(item.id)) void load(item.id);
    }
    setExpanded(next);
  };

  const open = (item: TreeItem) => {
    if (!item.open) return;
    const path = /^([a-zA-Z]:)?[\\/]/.test(item.open.path) ? item.open.path : `${ws.projectPath}/${item.open.path}`;
    void ws.documents.open(path);
  };

  const rows: { item: TreeItem; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const item of children.get(parent) ?? []) {
      rows.push({ item, depth });
      if (item.hasChildren && expanded.has(item.id)) walk(item.id, depth + 1);
    }
  };
  walk(ROOT, 0);

  return (
    <div role="tree" class="h-full overflow-auto py-1" data-testid={`module-panel-${panelId}`}>
      {error && <p class="px-3 text-muted">{error}</p>}
      {!error && rows.length === 0 && <p class="px-3 text-muted">Nothing to show yet.</p>}
      {rows.map(({ item, depth }) => (
        <TreeRow
          key={item.id}
          depth={depth}
          label={item.label}
          expanded={item.hasChildren ? expanded.has(item.id) : undefined}
          selected={item.id === selected}
          onClick={() => {
            setSelected(item.id);
            if (item.hasChildren) toggle(item);
            else open(item);
          }}
        />
      ))}
    </div>
  );
}
