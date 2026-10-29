import { describe, expect, it } from 'vitest';
import { DockLayoutModel } from '@renderer/panels/DockLayoutModel';
import { PanelRegistry } from '@renderer/panels/PanelRegistry';

function registry(): PanelRegistry {
  const panels = new PanelRegistry();
  for (const [id, dock] of [['project', 'left'], ['git', 'left'], ['terminal', 'bottom'], ['debug', 'bottom']] as const) {
    panels.register({ id, title: id, icon: null, defaultDock: dock, source: 'core', render: () => null });
  }
  return panels;
}

describe('debug layout', () => {
  it('switches to a debug layout and back, keeping each', () => {
    const layout = new DockLayoutModel(registry(), null);
    layout.resize('left', 300, 1000);
    layout.setMode('debug');
    const debug = layout.state.value.docks;
    expect(debug.bottom.active).toBe('debug');
    expect(debug.bottom.open).toBe(true);
    expect(debug.left.size).toBe(300);

    layout.show('git');
    layout.setMode('edit');
    expect(layout.state.value.docks.left.active).toBe('project');
    expect(layout.state.value.docks.bottom.active).not.toBe('debug');

    layout.setMode('debug');
    expect(layout.state.value.docks.left.active).toBe('git');
  });

  it('saves both layouts and restores them', () => {
    const panels = registry();
    const first = new DockLayoutModel(panels, null);
    first.setMode('debug');
    first.show('terminal');
    const saved = first.toJSON();
    expect(saved.docks.bottom.open).toBe(false);
    expect(saved.debugDocks?.bottom).toMatchObject({ active: 'terminal', open: true });

    const second = new DockLayoutModel(panels, saved);
    second.setMode('debug');
    expect(second.state.value.docks.bottom.active).toBe('terminal');
  });
});
