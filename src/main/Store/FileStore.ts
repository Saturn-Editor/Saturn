import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * A JSON file with defaults and validation. Missing, corrupt or invalid files read as the defaults,
 * writes are atomic (temp file + rename), and updates are serialised so concurrent calls don't race.
 */
export class FileStore<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly defaults: T,
    private readonly validate: (v: unknown) => v is T,
  ) {}

  async read(): Promise<T> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      return this.validate(parsed) ? parsed : structuredClone(this.defaults);
    } catch {
      return structuredClone(this.defaults);
    }
  }

  write(value: T): Promise<void> {
    return this.enqueue(() => this.writeNow(value));
  }

  update(fn: (v: T) => T): Promise<T> {
    return this.enqueue(async () => {
      const next = fn(await this.read());
      await this.writeNow(next);
      return next;
    });
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeNow(value: T): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, this.file);
  }
}
