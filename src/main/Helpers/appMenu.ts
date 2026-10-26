import { join } from 'node:path';
import { app, Menu, shell } from 'electron';

export const GITHUB_URL = 'https://github.com/Saturn-Editor/Saturn';
const AUTHOR = 'Lewis Milburn';

/** The About panel (macOS/Linux) and the app menu with a Help → Saturn on GitHub link. */
export function setUpAppMenu(): void {
  app.setAboutPanelOptions({
    applicationName: 'Saturn',
    applicationVersion: app.getVersion(),
    version: '',
    credits: `By ${AUTHOR}\n${GITHUB_URL}`,
    copyright: `© ${new Date().getFullYear()} ${AUTHOR}`,
    website: GITHUB_URL,
    iconPath: join(app.getAppPath(), 'resources/icons/icon.png'),
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          { label: 'Saturn on GitHub', click: () => void shell.openExternal(GITHUB_URL) },
          ...(process.platform === 'darwin' ? [] : [{ role: 'about' as const, label: 'About Saturn' }]),
        ],
      },
    ]),
  );
}
