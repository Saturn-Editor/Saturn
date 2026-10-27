import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { shell } from 'electron';

/** How long a deleted file can be brought back with Undo before it goes to the system Trash. */
const UNDO_MS = 30_000;

/** Moves a file or folder, copying across disks when a plain rename can't. */
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await cp(from, to, { recursive: true, preserveTimestamps: true });
    await rm(from, { recursive: true, force: true });
  }
}

/**
 * Deleting from the Project panel without a confirmation, but with Undo: the item is held in Saturn's
 * own folder for 30 seconds (the system Trash can't be restored from), then moved to the Trash.
 */
export class TrashService {
  private readonly held = new Map<string, { original: string; path: string; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly dir: string) {}

  /** Sends anything left over from a previous run (e.g. a crash during the undo window) to the Trash. */
  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const id of await readdir(this.dir)) {
      const folder = join(this.dir, id);
      for (const name of await readdir(folder).catch(() => [])) await shell.trashItem(join(folder, name)).catch(() => undefined);
      await rm(folder, { recursive: true, force: true });
    }
  }

  /** Takes the item away and returns an id for `undo`. */
  async remove(full: string): Promise<string> {
    const id = randomUUID();
    const path = join(this.dir, id, basename(full));
    await mkdir(dirname(path), { recursive: true });
    await move(full, path);
    this.held.set(id, { original: full, path, timer: setTimeout(() => void this.finish(id), UNDO_MS) });
    return id;
  }

  /** Puts a deleted item back where it was; resolves to its path. */
  async undo(id: string): Promise<string> {
    const item = this.held.get(id);
    if (!item) throw new Error("It's too late to undo that; it's in the Trash now");
    if (existsSync(item.original)) throw new Error(`Something new is at ${basename(item.original)} now, so it can't be put back`);
    clearTimeout(item.timer);
    this.held.delete(id);
    await mkdir(dirname(item.original), { recursive: true });
    await move(item.path, item.original);
    await rm(join(this.dir, id), { recursive: true, force: true });
    return item.original;
  }

  /** Quitting ends every undo window: held items go to the Trash. */
  async finishAll(): Promise<void> {
    await Promise.all([...this.held.keys()].map((id) => this.finish(id)));
  }

  private async finish(id: string): Promise<void> {
    const item = this.held.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    this.held.delete(id);
    await shell.trashItem(item.path).catch((e) => console.error('Moving to the Trash failed', e));
    await rm(join(this.dir, id), { recursive: true, force: true });
  }
}
