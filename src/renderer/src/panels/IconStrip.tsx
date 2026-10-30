import { useEffect, useRef, useState } from 'preact/hooks';
import type { DockId } from '@shared/types';
import { ContextMenu, IconButton, MoreIcon } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { fitStrip } from './fitStrip';

const ITEM_PX = 32;
const GAP_PX = 16;
export const PANEL_DRAG_TYPE = 'application/x-saturn-panel';

/** The far-left strip: left-dock panels at the top, bottom-dock panels at the bottom, never overlapping. */
export function IconStrip() {
  const ws = useWorkspace();
  const { docks } = ws.layout.state.value;
  ws.panels.changed.value; // re-render when panels are added or removed
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = fitStrip({ top: docks.left.panels.length, bottom: docks.bottom.panels.length }, height - 8, ITEM_PX, GAP_PX);
  const top = docks.left.panels.slice(0, fit.topVisible);
  const bottom = docks.bottom.panels.slice(0, fit.bottomVisible);
  const hidden = [...docks.left.panels.slice(fit.topVisible), ...docks.bottom.panels.slice(fit.bottomVisible)];

  const icon = (id: string, dock: DockId) => {
    const def = ws.panels.get(id);
    if (!def) return null;
    const showing = docks[dock].open && docks[dock].active === id;
    return (
      <div
        key={id}
        draggable
        data-testid={`strip-${id}`}
        onDragStart={(e) => e.dataTransfer?.setData(PANEL_DRAG_TYPE, id)}
      >
        <IconButton icon={def.icon} label={def.title} active={showing} onClick={() => ws.layout.toggle(id)} />
      </div>
    );
  };

  const dropZone = (dock: DockId) => ({
    onDragOver: (e: DragEvent) => e.dataTransfer?.types.includes(PANEL_DRAG_TYPE) && e.preventDefault(),
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer?.getData(PANEL_DRAG_TYPE);
      if (!id) return;
      const items = [...(e.currentTarget as HTMLElement).children].filter((el) => (el as HTMLElement).dataset.testid !== `strip-${id}`);
      const before = items.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      ws.layout.move(id, dock, before === -1 ? items.length : before);
    },
  });

  return (
    <div ref={ref} class="relative w-9 shrink-0 flex flex-col items-center py-1 bg-panel border-r border-divider" data-testid="icon-strip">
      <div class="flex flex-col items-center gap-1" data-testid="strip-top" {...dropZone('left')}>
        {top.map((id) => icon(id, 'left'))}
      </div>
      <div class="flex-1 w-full" style={{ minHeight: `${GAP_PX}px` }} />
      {fit.overflow && (
        <span ref={moreRef}>
          <IconButton icon={<MoreIcon />} label="More panels" onClick={() => setMoreOpen(!moreOpen)} />
        </span>
      )}
      <div class="flex flex-col items-center gap-1" data-testid="strip-bottom" {...dropZone('bottom')}>
        {bottom.map((id) => icon(id, 'bottom'))}
      </div>
      {moreOpen && fit.overflow && (
        <ContextMenu
          class="left-9 bottom-2 w-48"
          anchor={moreRef}
          items={hidden.map((id) => ({ id, label: ws.panels.get(id)?.title ?? id, icon: ws.panels.get(id)?.icon }))}
          onPick={(id) => ws.layout.show(id)}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </div>
  );
}
