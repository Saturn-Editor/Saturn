import { signal } from '@preact/signals';
import type { ComponentChild } from 'preact';
import type { DockId } from '@shared/types';

export interface PanelContext {
  projectPath: string;
}

export interface PanelDefinition {
  id: string;
  title: string;
  icon: ComponentChild;
  defaultDock: DockId;
  render: (ctx: PanelContext) => ComponentChild;
  /** Buttons at the right of the panel's title bar (e.g. the Project panel's Expand all). */
  actions?: () => ComponentChild;
  /** 'core' for built-in panels, otherwise the module id that added it (Plan 3). */
  source: 'core' | string;
}

/** Every panel the editor knows about. Modules add and remove panels here at runtime. */
export class PanelRegistry {
  private readonly panels = new Map<string, PanelDefinition>();
  /** Bumped on every change so views can re-render. */
  readonly changed = signal(0);

  register(def: PanelDefinition): () => void {
    this.panels.set(def.id, def);
    this.changed.value++;
    return () => {
      if (this.panels.get(def.id) === def) {
        this.panels.delete(def.id);
        this.changed.value++;
      }
    };
  }

  get(id: string): PanelDefinition | undefined {
    return this.panels.get(id);
  }

  all(): PanelDefinition[] {
    return [...this.panels.values()];
  }
}
