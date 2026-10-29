import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const SKIP = new Set(['.git', 'node_modules']);

/** Converts a glob like "**\/*.md", "src/*.ts" or "**\/*.{test,spec}.js" to a RegExp matched against '/'-separated relative paths. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '{') {
      braces++;
      source += '(?:';
    } else if (ch === '}' && braces > 0) {
      braces--;
      source += ')';
    } else if (ch === ',' && braces > 0) source += '|';
    else if (ch === '*' && glob[i + 1] === '*') {
      source += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '');
}

/** Files under `root` matching `glob`, as absolute paths. Skips .git and node_modules; stops at `limit`. */
export async function findFiles(root: string, glob: string, limit = 2000): Promise<string[]> {
  const pattern = globToRegExp(glob);
  const found: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) await walk(full);
      } else if (pattern.test(relative(root, full).split(sep).join('/'))) {
        found.push(full);
      }
    }
  };
  await walk(root);
  return found;
}
