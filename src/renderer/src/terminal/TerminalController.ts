import { signal } from '@preact/signals';
import type { SaturnApi } from '@shared/api';

const HISTORY_CHUNKS = 5000;

export interface TerminalTab {
  id: string;
  name: string;
  exited: boolean;
}

/** The terminals open in an editor window. The Terminal panel renders them; Run opens them too. */
export class TerminalController {
  readonly tabs = signal<TerminalTab[]>([]);
  readonly activeId = signal<string | null>(null);
  private readonly buffers = new Map<string, string[]>();
  private readonly listeners = new Map<string, (data: string) => void>();

  constructor(private readonly api: Pick<SaturnApi, 'terminal'>, private readonly projectPath: string) {
    // Output is kept as history so a terminal view can be unmounted (panel hidden) and re-attached.
    api.terminal.onData((id, data) => {
      const history = this.bufferFor(id);
      history.push(data);
      if (history.length > HISTORY_CHUNKS) history.splice(0, history.length - HISTORY_CHUNKS);
      this.listeners.get(id)?.(data);
    });
    api.terminal.onExit((id) => {
      this.tabs.value = this.tabs.value.map((t) => (t.id === id ? { ...t, exited: true } : t));
    });
  }

  async openTerminal(opts: { name?: string; command?: string; cwd?: string } = {}): Promise<string> {
    const name = opts.name ?? `Terminal ${this.tabs.value.length + 1}`;
    const id = await this.api.terminal.create({ cwd: opts.cwd ?? this.projectPath, name, command: opts.command });
    this.tabs.value = [...this.tabs.value, { id, name, exited: false }];
    this.activeId.value = id;
    return id;
  }

  /** Connects a view to a terminal's output, replaying its history first. */
  attach(id: string, write: (data: string) => void): () => void {
    for (const chunk of this.buffers.get(id) ?? []) write(chunk);
    this.listeners.set(id, write);
    return () => this.listeners.delete(id);
  }

  write(id: string, data: string): void {
    this.api.terminal.write(id, data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.api.terminal.resize(id, cols, rows);
  }

  stop(id: string): void {
    this.api.terminal.kill(id);
    this.tabs.value = this.tabs.value.map((t) => (t.id === id ? { ...t, exited: true } : t));
  }

  close(id: string): void {
    this.api.terminal.kill(id);
    this.buffers.delete(id);
    this.listeners.delete(id);
    const remaining = this.tabs.value.filter((t) => t.id !== id);
    this.tabs.value = remaining;
    if (this.activeId.value === id) this.activeId.value = remaining.at(-1)?.id ?? null;
  }

  /** Output can arrive before `create` resolves, so history is created on first use. */
  private bufferFor(id: string): string[] {
    let buffer = this.buffers.get(id);
    if (!buffer) this.buffers.set(id, (buffer = []));
    return buffer;
  }

  isRunning(id: string | null): boolean {
    return !!id && this.tabs.value.some((t) => t.id === id && !t.exited);
  }
}
