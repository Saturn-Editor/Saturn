import { useEffect, useRef, useState } from 'preact/hooks';
import type { TreeItem } from '@shared/modules';
import { Badge, ContextMenu, TreeRow } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { errorText } from '@renderer/helpers';

const ROOT = '\0root';

const expandedByPanel = new Map<string, Set<string>>();

/**
 * A tree panel whose items come from a language module (via the extension host). Clicking an item
 * opens its file if it has one, otherwise expands it; the chevron always expands. Right-click shows
 * the item's actions.
 */
export function ModuleTreePanel({ panelId }: { panelId: string }) {
  const ws = useWorkspace();
  const [children, setChildren] = useState<Map<string, TreeItem[]>>(new Map());
  const memoryKey = `${ws.projectPath}\0${panelId}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedByPanel.get(memoryKey) ?? new Set());
  expandedByPanel.set(memoryKey, expanded);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: TreeItem } | null>(null);
  // The refresh listener is registered once, so it reads the expanded set through a ref.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const load = async (parentId: string | null) => {
    try {
      const items = await window.saturn.modules.treeChildren(panelId, parentId);
      setChildren((prev) => new Map(prev).set(parentId ?? ROOT, items));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    void load(null);
    expandedRef.current.forEach((p) => void load(p));
    // A refresh of one item reloads just that subtree; a full refresh reloads the root and every expanded item.
    return window.saturn.modules.onTreeRefresh((id, itemId) => {
      if (id !== panelId) return;
      if (itemId) {
        void load(itemId);
        return;
      }
      void load(null);
      expandedRef.current.forEach((p) => void load(p));
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
    void ws.documents.open(path, { line: item.open.line, column: item.open.column });
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
          icon={item.badge ? <Badge text={item.badge} /> : undefined}
          description={item.description}
          tooltip={item.tooltip}
          expanded={item.hasChildren ? expanded.has(item.id) : undefined}
          selected={item.id === selected}
          onToggle={() => toggle(item)}
          onClick={() => {
            setSelected(item.id);
            if (item.open) open(item);
            else if (item.hasChildren) toggle(item);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setSelected(item.id);
            if (item.actions?.length) setMenu({ x: e.clientX, y: e.clientY, item });
          }}
        />
      ))}
      {menu && (
        <ContextMenu
          at={menu}
          items={(menu.item.actions ?? []).map((a) => ({ id: a.id, label: a.label }))}
          onPick={(actionId) => void window.saturn.modules.treeAction(panelId, actionId, menu.item).catch((e) => setError(errorText(e)))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
