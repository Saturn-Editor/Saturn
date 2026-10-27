import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, showPanel, type DecorationSet, type Panel } from '@codemirror/view';
import type { Breakpoint } from '@shared/types';

/** A breakpoint's dot: plain, conditional (a bar across it) or a logpoint (a diamond). */
class BreakpointMarker extends GutterMarker {
  constructor(readonly condition?: string, readonly logMessage?: string) {
    super();
  }

  eq(other: BreakpointMarker) {
    return other.condition === this.condition && other.logMessage === this.logMessage;
  }

  toDOM() {
    const dot = document.createElement('span');
    dot.className = `cm-saturn-breakpoint${this.logMessage ? ' cm-saturn-logpoint' : this.condition ? ' cm-saturn-conditional' : ''}`;
    dot.title = this.logMessage ? `Logs: ${this.logMessage}` : this.condition ? `Stops when: ${this.condition}` : 'Breakpoint';
    return dot;
  }
}

const plain = new BreakpointMarker();
const markerFor = (b: Partial<Breakpoint>) => (b.condition || b.logMessage ? new BreakpointMarker(b.condition, b.logMessage) : plain);

/** Toggles the breakpoint on the line starting at this position. */
const toggleEffect = StateEffect.define<number>();
/** Replaces the breakpoint on the line starting at `pos` (its condition or log message changed). */
const updateEffect = StateEffect.define<{ pos: number; condition?: string; logMessage?: string }>();
/** Replaces every breakpoint (another editor of the same file changed them). */
export const setBreakpointLines = StateEffect.define<Breakpoint[]>();

function setFrom(state: EditorState, list: Breakpoint[]): RangeSet<GutterMarker> {
  return RangeSet.of(list.filter((b) => b.line >= 1 && b.line <= state.doc.lines).map((b) => markerFor(b).range(state.doc.line(b.line).from)), true);
}

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpointLines)) next = setFrom(tr.state, e.value);
      if (e.is(updateEffect)) {
        next = next.update({ filter: (from) => from !== e.value.pos, add: [markerFor(e.value).range(e.value.pos)] });
      }
      if (e.is(toggleEffect)) {
        let has = false;
        next.between(e.value, e.value, () => {
          has = true;
        });
        next = has ? next.update({ filter: (from) => from !== e.value }) : next.update({ add: [plain.range(e.value)] });
      }
    }
    return next;
  },
});

/** The editor's breakpoints, by line (sorted). */
export function breakpointLines(state: EditorState): Breakpoint[] {
  const byLine = new Map<number, Breakpoint>();
  state.field(breakpointField, false)?.between(0, state.doc.length, (from, _to, marker) => {
    const m = marker as BreakpointMarker;
    const line = state.doc.lineAt(from).number;
    byLine.set(line, { line, ...(m.condition && { condition: m.condition }), ...(m.logMessage && { logMessage: m.logMessage }) });
  });
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

/** Adds or removes the breakpoint on the line at `pos` (the cursor by default). False in editors without breakpoints. */
export function toggleBreakpoint(view: EditorView, pos = view.state.selection.main.head): boolean {
  if (!view.state.field(breakpointField, false)) return false;
  view.dispatch({ effects: toggleEffect.of(view.state.doc.lineAt(pos).from) });
  return true;
}

/** The breakpoint editor at the bottom of the editor: a condition, or a message to log instead of stopping. */
type Editing = { pos: number; kind: 'condition' | 'log' };
const editBreakpoint = StateEffect.define<Editing | null>();

function editorPanel(view: EditorView, editing: Editing): Panel {
  const line = view.state.doc.lineAt(editing.pos).number;
  const current = breakpointLines(view.state).find((b) => b.line === line);
  const dom = document.createElement('div');
  dom.className = 'cm-saturn-rename';
  dom.dataset.testid = 'breakpoint-editor';
  const label = document.createElement('span');
  label.textContent = editing.kind === 'condition' ? `Line ${line}: stop only when` : `Line ${line}: log (use {expression} for values)`;
  const input = document.createElement('input');
  input.className = 'cm-textfield';
  input.value = (editing.kind === 'condition' ? current?.condition : current?.logMessage) ?? '';
  input.placeholder = editing.kind === 'condition' ? 'e.g. count > 10' : 'e.g. count is {count}';
  const close = () => {
    view.dispatch({ effects: editBreakpoint.of(null) });
    view.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = input.value.trim() || undefined;
    // A logpoint and a condition can be combined; setting one keeps the other.
    const next = editing.kind === 'condition'
      ? { condition: value, logMessage: current?.logMessage }
      : { condition: current?.condition, logMessage: value };
    view.dispatch({ effects: [updateEffect.of({ pos: editing.pos, ...next }), editBreakpoint.of(null)] });
    view.focus();
  });
  dom.append(label, input);
  return { dom, mount: () => input.select() };
}

const editingField = StateField.define<Editing | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(editBreakpoint)) return e.value;
    return value && tr.docChanged ? { ...value, pos: tr.state.doc.lineAt(tr.changes.mapPos(value.pos)).from } : value;
  },
  provide: (f) => showPanel.from(f, (editing) => (editing ? (view) => editorPanel(view, editing) : null)),
});

/** Opens the breakpoint editor for the line at `pos`, adding a breakpoint there if there isn't one. */
export function editBreakpointAt(view: EditorView, pos: number, kind: 'condition' | 'log'): void {
  const from = view.state.doc.lineAt(pos).from;
  const exists = breakpointLines(view.state).some((b) => b.line === view.state.doc.lineAt(pos).number);
  view.dispatch({ effects: [...(exists ? [] : [toggleEffect.of(from)]), editBreakpoint.of({ pos: from, kind })] });
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
 * remove one; right-click for a condition or a log message (`onMenu` shows that menu). They follow
 * edits; `onChange` hears the new list. Also highlights the paused line.
 */
export function breakpoints(initial: Breakpoint[], onChange: (list: Breakpoint[]) => void, onMenu: (view: EditorView, pos: number, e: MouseEvent) => void): Extension {
  return [
    breakpointField.init((state) => setFrom(state, initial)),
    editingField,
    executionField,
    gutter({
      class: 'cm-saturn-breakpoints',
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => plain,
      domEventHandlers: {
        mousedown: (view, line, e) => (e as MouseEvent).button === 0 && toggleBreakpoint(view, line.from),
        contextmenu: (view, line, e) => {
          e.preventDefault();
          onMenu(view, line.from, e as MouseEvent);
          return true;
        },
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.startState.field(breakpointField) === update.state.field(breakpointField)) return;
      const before = breakpointLines(update.startState);
      const after = breakpointLines(update.state);
      if (JSON.stringify(before) !== JSON.stringify(after)) onChange(after);
    }),
  ];
}
