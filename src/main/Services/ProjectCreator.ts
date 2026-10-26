import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { NewProjectRequest } from '@shared/types';

const run = promisify(execFile);
const INVALID_NAME = /[/\\:*?"<>|]/;

export class ProjectCreator {
  /** Creates the project folder (and optionally a git repo) and returns its path. */
  async create(req: NewProjectRequest): Promise<string> {
    const name = req.name.trim();
    if (!name || INVALID_NAME.test(name)) {
      throw new Error('Name can\'t be empty or contain / \\ : * ? " < > |');
    }
    const path = join(req.parentDir, name);
    if (await this.exists(path)) throw new Error(`A folder named ${name} already exists`);

    await mkdir(path, { recursive: true });
    if (req.gitInit) {
      try {
        await run('git', ['init'], { cwd: path });
      } catch {
        throw new Error("Git isn't installed or isn't on PATH");
      }
    }
    return path;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
