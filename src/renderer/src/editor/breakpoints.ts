import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, type DecorationSet } from '@codemirror/view';

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement('span');
    dot.className = 'cm-saturn-breakpoint';
    return dot;
  }
}

const marker = new BreakpointMarker();
/** Toggles the breakpoint on the line starting at this position. */
const toggleEffect = StateEffect.define<number>();

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(toggleEffect)) continue;
      let has = false;
      next.between(e.value, e.value, () => {
        has = true;
      });
      next = has ? next.update({ filter: (from) => from !== e.value }) : next.update({ add: [marker.range(e.value)] });
    }
    return next;
  },
});

/** The editor's breakpoint lines (1-based, sorted). */
function linesOf(state: EditorState): number[] {
  const lines = new Set<number>();
  state.field(breakpointField).between(0, state.doc.length, (from) => {
    lines.add(state.doc.lineAt(from).number);
  });
  return [...lines].sort((a, b) => a - b);
}

/** Adds or removes the breakpoint on the line at `pos` (the cursor by default). False in editors without breakpoints. */
export function toggleBreakpoint(view: EditorView, pos = view.state.selection.main.head): boolean {
  if (!view.state.field(breakpointField, false)) return false;
  view.dispatch({ effects: toggleEffect.of(view.state.doc.lineAt(pos).from) });
  return true;
}

/** Where the paused program is: a highlighted line (1-based), or null. */
export const setExecutionLine = StateEffect.define<number | null>();

const executionDecoration = Decoration.line({ class: 'cm-saturn-execution' });

const executionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setExecutionLine)) continue;
      next = e.value === null ? Decoration.none : Decoration.set([executionDecoration.range(tr.state.doc.line(Math.min(Math.max(1, e.value), tr.state.doc.lines)).from)]);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Breakpoints in a thin column left of the line numbers: click there or on a line number to add or
 * remove one. They follow edits; `onChange` hears the new lines. Also highlights the paused line.
 */
export function breakpoints(initial: number[], onChange: (lines: number[]) => void): Extension {
  return [
    breakpointField.init((state) => RangeSet.of(initial.filter((l) => l >= 1 && l <= state.doc.lines).map((l) => marker.range(state.doc.line(l).from)), true)),
    executionField,
    gutter({
      class: 'cm-saturn-breakpoints',
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => marker,
      domEventHandlers: {
        mousedown: (view, line) => toggleBreakpoint(view, line.from),
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.startState.field(breakpointField) === update.state.field(breakpointField)) return;
      const before = linesOf(update.startState);
      const after = linesOf(update.state);
      if (before.join() !== after.join()) onChange(after);
    }),
  ];
}
