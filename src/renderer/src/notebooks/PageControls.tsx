import { useEffect, useState } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { ContextMenu } from '@renderer/components';

interface Block {
  pos: number;
  node: PmNode;
  dom: HTMLElement;
  top: number;
}

interface TableBox {
  left: number;
  top: number;
  width: number;
  rows: { top: number; height: number; cell: HTMLElement }[];
  columns: { left: number; width: number; cell: HTMLElement }[];
}

function blockAt(editor: Editor, clientY: number, wrapper: HTMLElement): Block | null {
  const view = editor.view;
  const content = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: content.left + 4, top: clientY });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
  if ($pos.depth < 1 && !view.state.doc.nodeAt(hit.pos)) return null;
  const pos = $pos.depth >= 1 ? $pos.before(1) : hit.pos;
  const node = view.state.doc.nodeAt(pos);
  const dom = view.nodeDOM(pos);
  if (!node || !(dom instanceof HTMLElement)) return null;
  return { pos, node, dom, top: dom.getBoundingClientRect().top - wrapper.getBoundingClientRect().top };
}

function tableBox(dom: HTMLElement, wrapper: HTMLElement): TableBox | null {
  const table = dom.querySelector('table');
  if (!table) return null;
  const origin = wrapper.getBoundingClientRect();
  const box = table.getBoundingClientRect();
  const rows = [...table.rows].map((row) => {
    const r = row.getBoundingClientRect();
    return { top: r.top - origin.top, height: r.height, cell: row.cells[0] as HTMLElement };
  });
  const columns = [...(table.rows[0]?.cells ?? [])].map((cell) => {
    const r = cell.getBoundingClientRect();
    return { left: r.left - origin.left, width: r.width, cell: cell as HTMLElement };
  });
  return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, rows, columns };
}

const BUTTON = 'size-5 flex items-center justify-center text-muted hover:text-strong hover:bg-hover';

export function PageControls({ editor, wrapper }: { editor: Editor; wrapper: HTMLElement }) {
  const [block, setBlock] = useState<Block | null>(null);
  const [table, setTable] = useState<TableBox | null>(null);
  const [menu, setMenu] = useState<{ kind: 'block' | 'table'; x: number; y: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (menu) return;
      const found = blockAt(editor, e.clientY, wrapper);
      setBlock(found);
      setTable(found?.node.type.name === 'table' ? tableBox(found.dom, wrapper) : null);
    };
    const leave = () => {
      if (menu) return;
      setBlock(null);
      setTable(null);
    };
    const changed = () => setBlock(null);
    wrapper.addEventListener('mousemove', move);
    wrapper.addEventListener('mouseleave', leave);
    editor.on('update', changed);
    return () => {
      wrapper.removeEventListener('mousemove', move);
      wrapper.removeEventListener('mouseleave', leave);
      editor.off('update', changed);
    };
  }, [editor, wrapper, menu]);

  if (!block) return null;
  const { pos, node } = block;
  const doc = editor.state.doc;
  let index = -1;
  doc.forEach((_child, offset, i) => {
    if (offset === pos) index = i;
  });
  const previous = index > 0 ? doc.child(index - 1) : null;
  const next = index < doc.childCount - 1 ? doc.child(index + 1) : null;

  const addBelow = () => {
    const at = pos + node.nodeSize;
    editor.chain().focus().insertContentAt(at, { type: 'paragraph', content: [{ type: 'text', text: '/' }] }).setTextSelection(at + 2).run();
  };
  const moveUp = () => {
    if (!previous) return;
    const tr = editor.state.tr.delete(pos, pos + node.nodeSize).insert(pos - previous.nodeSize, node);
    editor.view.dispatch(tr);
  };
  const moveDown = () => {
    if (!next) return;
    const tr = editor.state.tr.delete(pos, pos + node.nodeSize).insert(pos + next.nodeSize, node);
    editor.view.dispatch(tr);
  };
  const remove = () => editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  const inCell = (cell: HTMLElement) => editor.chain().focus().setTextSelection(editor.view.posAtDOM(cell, 0));

  const dragStart = (e: DragEvent) => {
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.dragging = { slice: view.state.selection.content(), move: true };
    e.dataTransfer?.setData('text/plain', node.textContent);
    e.dataTransfer?.setDragImage(block.dom, 0, 0);
  };

  const cursorInTable = editor.isActive('table');

  return (
    <>
      <div class="absolute left-0 flex items-center gap-0.5" style={{ top: `${block.top}px` }} data-testid="notebook-block-controls">
        <button type="button" class={BUTTON} title="Add a block below" aria-label="Add a block below" onMouseDown={(e) => e.preventDefault()} onClick={addBelow}>+</button>
        <span
          role="button"
          draggable
          class={`${BUTTON} cursor-grab`}
          title="Drag to move, click for options"
          aria-label="Block options"
          onDragStart={dragStart}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => setMenu({ kind: 'block', x: e.clientX, y: e.clientY })}
        >⋮⋮</span>
      </div>
      {table && (
        <>
          <button
            type="button"
            class={`${BUTTON} absolute`}
            style={{ left: `${table.left - 20}px`, top: `${table.top - 20}px` }}
            title="Table options"
            aria-label="Table options"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => setMenu({ kind: 'table', x: e.clientX, y: e.clientY })}
          >⋯</button>
          {table.columns.map((c, i) => (
            <button
              key={`c${i}`}
              type="button"
              class={`${BUTTON} absolute`}
              style={{ left: `${c.left + c.width - 10}px`, top: `${table.top - 20}px` }}
              title="Add a column to the right"
              aria-label="Add a column to the right"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => inCell(c.cell).addColumnAfter().run()}
            >+</button>
          ))}
          {table.rows.map((r, i) => (
            <button
              key={`r${i}`}
              type="button"
              class={`${BUTTON} absolute`}
              style={{ left: `${table.left + table.width + 2}px`, top: `${r.top + r.height - 10}px` }}
              title="Add a row below"
              aria-label="Add a row below"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => inCell(r.cell).addRowAfter().run()}
            >+</button>
          ))}
        </>
      )}
      {menu && (
        <ContextMenu
          at={{ x: menu.x, y: menu.y }}
          items={menu.kind === 'block'
            ? [
              ...(previous ? [{ id: 'up', label: 'Move up' }] : []),
              ...(next ? [{ id: 'down', label: 'Move down' }] : []),
              { id: 'delete', label: 'Delete' },
            ]
            : [
              { id: 'header', label: 'Header row' },
              ...(cursorInTable ? [{ id: 'delete-row', label: 'Delete row' }, { id: 'delete-column', label: 'Delete column' }] : []),
              { id: 'delete-table', label: 'Delete table' },
            ]}
          onPick={(id) => {
            if (id === 'up') moveUp();
            if (id === 'down') moveDown();
            if (id === 'delete') remove();
            if (id === 'header' && table) inCell(table.rows[0].cell).toggleHeaderRow().run();
            if (id === 'delete-row') editor.chain().focus().deleteRow().run();
            if (id === 'delete-column') editor.chain().focus().deleteColumn().run();
            if (id === 'delete-table' && table) inCell(table.rows[0].cell).deleteTable().run();
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
