import { signal } from '@preact/signals';
import type { DockId, DockState, LayoutState } from '@shared/types';
import type { PanelRegistry } from './PanelRegistry';

const MIN_SIZE = 120;
const MAX_FRACTION = 0.6;

const DEFAULTS: LayoutState = {
  docks: {
    left: { panels: [], active: 'project', size: 260, open: true },
    bottom: { panels: [], active: 'terminal', size: 220, open: false },
  },
};

const DOCKS: DockId[] = ['left', 'bottom'];

/** Which panels live in which dock, which one is showing, and how big each dock is. */
export class DockLayoutModel {
  readonly state = signal<LayoutState>(structuredClone(DEFAULTS));
  readonly mode = signal<'edit' | 'debug'>('edit');
  private other: Record<DockId, DockState> | null = null;

  constructor(private readonly registry: PanelRegistry, saved: LayoutState | null) {
    if (saved) {
      this.state.value = { docks: structuredClone(saved.docks) };
      if (saved.debugDocks?.left && saved.debugDocks.bottom) this.other = structuredClone(saved.debugDocks);
    }
    this.sync();
  }

  /** Swaps between the editing layout and the debugging layout, keeping changes to each. */
  setMode(mode: 'edit' | 'debug'): void {
    if (mode === this.mode.value) return;
    const current = this.state.value.docks;
    const next = this.other ?? (mode === 'debug' ? this.debugDefaults(current) : structuredClone(DEFAULTS.docks));
    this.other = structuredClone(current);
    this.mode.value = mode;
    this.state.value = { docks: structuredClone(next) };
    this.sync();
  }

  private debugDefaults(edit: Record<DockId, DockState>): Record<DockId, DockState> {
    const others = (list: string[]) => list.filter((p) => p !== 'debug');
    return {
      left: { ...edit.left, panels: others(edit.left.panels) },
      bottom: { panels: ['debug', ...others(edit.bottom.panels)], active: 'debug', size: Math.max(edit.bottom.size, 300), open: true },
    };
  }

  dockOf(panelId: string): DockId | null {
    return DOCKS.find((d) => this.state.value.docks[d].panels.includes(panelId)) ?? null;
  }

  /** Clicking the showing panel's icon closes its dock; clicking any other icon shows that panel. */
  toggle(panelId: string): void {
    const dock = this.dockOf(panelId);
    if (!dock) return;
    this.updateDock(dock, (d) =>
      d.open && d.active === panelId ? { ...d, open: false } : { ...d, open: true, active: panelId },
    );
  }

  /** Shows a panel (opening its dock) without ever closing it. */
  show(panelId: string): void {
    const dock = this.dockOf(panelId);
    if (dock) this.updateDock(dock, (d) => ({ ...d, open: true, active: panelId }));
  }

  move(panelId: string, target: DockId, index: number): void {
    const from = this.dockOf(panelId);
    if (!from) return;
    const docks = structuredClone(this.state.value.docks);
    const source = docks[from];
    source.panels = source.panels.filter((p) => p !== panelId);
    if (source.active === panelId) source.active = source.panels[0] ?? null;
    if (source.panels.length === 0) source.open = false;

    const dest = docks[target];
    const at = Math.max(0, Math.min(index, dest.panels.length));
    dest.panels.splice(at, 0, panelId);
    dest.active = panelId;
    dest.open = true;
    this.state.value = { docks };
  }

  resize(dock: DockId, sizePx: number, maxPx: number): void {
    const size = Math.round(Math.max(MIN_SIZE, Math.min(sizePx, Math.max(MIN_SIZE, maxPx))));
    this.updateDock(dock, (d) => ({ ...d, size }));
  }

  clampTo(viewport: { width: number; height: number }): void {
    const { left, bottom } = this.state.value.docks;
    const maxLeft = Math.max(MIN_SIZE, Math.floor(viewport.width * MAX_FRACTION));
    const maxBottom = Math.max(MIN_SIZE, Math.floor(viewport.height * MAX_FRACTION));
    if (left.size > maxLeft) this.updateDock('left', (d) => ({ ...d, size: maxLeft }));
    if (bottom.size > maxBottom) this.updateDock('bottom', (d) => ({ ...d, size: maxBottom }));
  }

  /** Adds newly registered panels to their default dock and drops panels that no longer exist. */
  sync(): void {
    const docks = structuredClone(this.state.value.docks);
    const known = new Set(this.registry.all().map((p) => p.id));
    for (const id of DOCKS) {
      const d = docks[id];
      d.panels = d.panels.filter((p) => known.has(p));
      if (d.active && !d.panels.includes(d.active)) d.active = d.panels[0] ?? null;
    }
    const placed = new Set(DOCKS.flatMap((d) => docks[d].panels));
    for (const def of this.registry.all()) {
      if (placed.has(def.id)) continue;
      const dock = docks[def.defaultDock];
      const terminal = dock.panels.indexOf('terminal');
      if (terminal >= 0) dock.panels.splice(terminal, 0, def.id);
      else dock.panels.push(def.id);
      dock.active ??= def.id;
    }
    this.state.value = { docks };
  }

  toJSON(): LayoutState {
    const current = structuredClone(this.state.value.docks);
    const other = this.other ? structuredClone(this.other) : undefined;
    return this.mode.value === 'edit' ? { docks: current, debugDocks: other } : { docks: other ?? current, debugDocks: current };
  }

  private updateDock(dock: DockId, fn: (d: DockState) => DockState): void {
    this.state.value = { docks: { ...this.state.value.docks, [dock]: fn(this.state.value.docks[dock]) } };
  }
}
