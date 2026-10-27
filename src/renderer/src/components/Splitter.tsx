interface SplitterProps {
  /** 'vertical' sits between left/right areas and drags horizontally; 'horizontal' sits between top/bottom. */
  direction: 'horizontal' | 'vertical';
  /** The current size (px) of the area this splitter resizes. */
  size: number;
  onResize: (sizePx: number) => void;
  /** Flip the sign, for splitters on the far side of the area they resize. */
  invert?: boolean;
}

/**
 * A draggable divider. The new size is always the size at drag start plus the total distance dragged
 * (never added up per move), and the pointer is captured, so the terminal or a preview frame under the
 * cursor can't swallow the drag. Updates are limited to one per frame.
 */
export function Splitter({ direction, size, onResize, invert }: SplitterProps) {
  const vertical = direction === 'vertical';
  const start = (e: PointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const origin = vertical ? e.clientX : e.clientY;
    const startSize = size;
    let frame = 0;
    let pending = startSize;
    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
    const move = (ev: PointerEvent) => {
      const offset = (vertical ? ev.clientX : ev.clientY) - origin;
      pending = startSize + (invert ? -offset : offset);
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        onResize(pending);
      });
    };
    const stop = (ev: PointerEvent) => {
      cancelAnimationFrame(frame);
      onResize(pending);
      document.body.style.cursor = '';
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };
  // A visible 1px divider with a wider invisible grab area centred on it.
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      class={`group relative shrink-0 bg-divider hover:bg-accent ${vertical ? 'w-px' : 'h-px'}`}
    >
      <div
        onPointerDown={start}
        data-testid={`splitter-${direction}`}
        class={`absolute z-10 touch-none ${vertical ? 'inset-y-0 -left-1 -right-1 cursor-col-resize' : 'inset-x-0 -top-1 -bottom-1 cursor-row-resize'}`}
      />
    </div>
  );
}
