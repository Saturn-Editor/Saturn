import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/** Locations inside Saturn's app-data folder, not project folders. */
export class AppPaths {
  constructor(readonly root: string) {}

  file(name: string): string {
    return join(this.root, name);
  }

  dir(name: string): string {
    return join(this.root, name);
  }

  /** A stable key for a project path (16 hex chars). */
  projectKey(projectPath: string): string {
    let normalised = resolve(projectPath);
    if (process.platform === 'win32') normalised = normalised.toLowerCase();
    return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
  }
}
