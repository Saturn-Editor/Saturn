import type { DockId } from '@shared/types';
import { CloseIcon, IconButton, Splitter } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { PANEL_DRAG_TYPE } from './IconStrip';

/** One dock (left or bottom): a header naming the showing panel, the panel itself, and a resize handle. */
export function Dock({ dock }: { dock: DockId }) {
  const ws = useWorkspace();
  const state = ws.layout.state.value.docks[dock];
  if (!state.open || !state.active) return null;
  const def = ws.panels.get(state.active);
  if (!def) return null;

  const isLeft = dock === 'left';
  const max = isLeft ? window.innerWidth * 0.6 : window.innerHeight * 0.6;
  const resize = (size: number) => ws.layout.resize(dock, size, max);

  const header = (
    <div
      class="flex items-center h-7 px-2.5 font-semibold text-strong border-b border-divider shrink-0"
      onDragOver={(e) => e.dataTransfer?.types.includes(PANEL_DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer?.getData(PANEL_DRAG_TYPE);
        if (id) ws.layout.move(id, dock, state.panels.length);
      }}
    >
      <span class="flex-1 truncate">{def.title}</span>
      <span class="flex items-center gap-0.5 font-normal -mr-1.5">
        {def.actions?.()}
        <IconButton class="size-6" icon={<CloseIcon class="size-3" />} label={`Close ${def.title}`} data-testid={`panel-close-${def.id}`} onClick={() => ws.layout.toggle(def.id)} />
      </span>
    </div>
  );

  const panel = (
    <div class="flex-1 min-h-0 min-w-0 overflow-hidden">
      {def.render({ projectPath: ws.projectPath })}
    </div>
  );

  return isLeft ? (
    <>
      <section class="flex flex-col bg-panel shrink-0" style={{ width: `${state.size}px` }} data-testid={`panel-${def.id}`} aria-label={def.title}>
        {header}
        {panel}
      </section>
      <Splitter direction="vertical" size={state.size} onResize={resize} />
    </>
  ) : (
    <>
      <Splitter direction="horizontal" size={state.size} invert onResize={resize} />
      <section class="flex flex-col bg-panel shrink-0" style={{ height: `${state.size}px` }} data-testid={`panel-${def.id}`} aria-label={def.title}>
        {header}
        {panel}
      </section>
    </>
  );
}
