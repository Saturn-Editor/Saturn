import { computed, signal } from '@preact/signals';
import type { SaturnApi } from '@shared/api';
import type { Breakpoint, DebugFrame, DebugState } from '@shared/types';

/** How many console entries the Debug panel keeps. */
const MAX_OUTPUT = 2000;

/**
 * One editor window's debug session as the renderer sees it, plus the project's breakpoints, its
 * watch expressions and which launch configuration is picked.
 */
export class DebugController {
  readonly state = signal<DebugState>({ state: 'idle', frames: [], scopes: [], threads: [], watches: [] });
  readonly output = signal<{ text: string; category: string }[]>([]);
  /** File path → breakpoints. */
  readonly breakpoints = signal<Record<string, Breakpoint[]>>({});
  /** Watch expressions (kept while Saturn runs; the values come back in `state.watches`). */
  readonly watches = signal<string[]>([]);
  /** The launch configuration Start Debugging uses: a configuration id, or null for the default. */
  readonly configuration = signal<string | null>(null);
  readonly tab = signal<'stack' | 'variables' | 'console' | 'breakpoints' | 'diagnostics'>('stack');
  /** The selected frame of the paused program (where the editor highlights), or null. */
  readonly frame = computed<DebugFrame | null>(() => {
    const s = this.state.value;
    return s.state === 'stopped' ? (s.frames.find((f) => f.id === s.frameId) ?? s.frames[0] ?? null) : null;
  });

  constructor(private readonly api: SaturnApi, private readonly reveal: (frame: DebugFrame) => void) {
    void api.debug.breakpoints().then((b) => (this.breakpoints.value = b));
    void api.debug.state().then((s) => (this.state.value = s));
    api.debug.onChanged((s) => {
      const paused = s.state === 'stopped' && (this.state.value.state !== 'stopped' || s.frameId !== this.state.value.frameId);
      this.state.value = s;
      // Pausing (or picking another frame) shows that code.
      const frame = this.frame.value;
      if (paused && frame?.path) this.reveal(frame);
    });
    api.debug.onOutput((text, category) => this.log(text, category));
  }

  get active(): boolean {
    return this.state.value.state !== 'idle';
  }

  log(text: string, category = 'console'): void {
    this.output.value = [...this.output.value, { text, category }].slice(-MAX_OUTPUT);
  }

  clearOutput(): void {
    this.output.value = [];
  }

  setBreakpoints(path: string, list: Breakpoint[]): void {
    const next = { ...this.breakpoints.value };
    if (list.length) next[path] = list;
    else delete next[path];
    this.breakpoints.value = next;
    void this.api.debug.setBreakpoints(path, list);
  }

  setWatches(expressions: string[]): void {
    this.watches.value = expressions;
    void this.api.debug.setWatches(expressions);
  }

  /** Debugs a file with the picked configuration, or attaches to a process. */
  async start(path: string, languageId: string, processId?: number): Promise<void> {
    this.clearOutput();
    await this.api.debug.setWatches(this.watches.value);
    await this.api.debug.start({ path, languageId, ...(processId === undefined ? { configuration: this.configuration.value ?? undefined } : { processId }) });
  }
}
