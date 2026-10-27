import { execFileSync } from 'node:child_process';

const MARKER = '__SATURN_PATH__';

/**
 * Apps opened from Finder or the Dock get launchd's bare PATH (/usr/bin:/bin:…), so tools installed via
 * nvm, Homebrew and the like aren't found. Copies PATH from the user's login shell, as the terminal sees it.
 */
export function adoptLoginShellPath(): void {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // Interactive login so .zshrc/.bashrc (where nvm usually lives) are sourced; markers skip any rc-file output.
    const output = execFileSync(shell, ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const path = output.split(MARKER)[1];
    if (path) process.env.PATH = path;
  } catch {
    // Keep the inherited PATH; missing tools are reported where they're needed.
  }
}
