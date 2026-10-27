import { signal } from '@preact/signals';
import type { ComponentChild } from 'preact';
import { fuzzyScore } from './fuzzy';

export interface Command {
  id: string;
  title: string;
  source: { id: 'core' | string; label: string; icon?: ComponentChild };
  run: () => void | Promise<void>;
}

/** Every action the user can run from action search. Modules register theirs here too (Plan 3). */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  readonly changed = signal(0);

  register(cmd: Command): () => void {
    this.commands.set(cmd.id, cmd);
    this.changed.value++;
    return () => {
      if (this.commands.get(cmd.id) === cmd) {
        this.commands.delete(cmd.id);
        this.changed.value++;
      }
    };
  }

  async run(id: string): Promise<void> {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`Unknown command: ${id}`);
    await cmd.run();
  }

  search(query: string, limit = 20): Command[] {
    return [...this.commands.values()]
      .map((cmd) => ({ cmd, score: fuzzyScore(query, cmd.title) }))
      .filter((r): r is { cmd: Command; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score || a.cmd.title.localeCompare(b.cmd.title))
      .slice(0, limit)
      .map((r) => r.cmd);
  }
}
