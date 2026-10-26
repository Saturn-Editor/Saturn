interface SplitterProps {
  /** 'vertical' sits between left/right areas and drags horizontally; 'horizontal' sits between top/bottom. */
  direction: 'horizontal' | 'vertical';
  onResize: (deltaPx: number) => void;
  /** Flip the sign, for splitters on the far side of the area they resize. */
  invert?: boolean;
}

export function Splitter({ direction, onResize, invert }: SplitterProps) {
  const vertical = direction === 'vertical';
  const start = (e: PointerEvent) => {
    e.preventDefault();
    let last = vertical ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const pos = vertical ? ev.clientX : ev.clientY;
      const delta = pos - last;
      last = pos;
      if (delta) onResize(invert ? -delta : delta);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
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
        class={`absolute z-10 ${vertical ? 'inset-y-0 -left-1 -right-1 cursor-col-resize' : 'inset-x-0 -top-1 -bottom-1 cursor-row-resize'}`}
      />
    </div>
  );
}
