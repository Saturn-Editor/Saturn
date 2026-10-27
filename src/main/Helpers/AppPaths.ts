import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/** Everything Saturn itself keeps in app-data (Chromium's own files there are left alone). Reset Saturn deletes these. */
export const SATURN_DATA = [
  'settings.json', 'recent-projects.json', 'modules.json', 'module-settings.json',
  'languages', 'extensions', 'themes', 'module-storage', 'layouts', 'run', 'breakpoints.json', 'language-choices.json',
];

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
