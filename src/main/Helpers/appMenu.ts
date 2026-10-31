import { join } from 'node:path';
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { channel } from '@shared/api';

export const GITHUB_URL = 'https://github.com/Saturn-Editor/Saturn';
const AUTHOR = 'Lewis Milburn';

/**
 * The About panel (macOS/Linux) and the app menu with a Help → Saturn on GitHub link. The menus avoid
 * shortcuts the keymaps use: Close Window is ⌘⇧W (⌘W is Close Tab), and View has no Reload or zoom
 * (⌘R is IntelliJ's Replace, and Appearance → Text size handles zoom).
 */
export function setUpAppMenu(): void {
  const mac = process.platform === 'darwin';
  app.setAboutPanelOptions({
    applicationName: 'Saturn',
    applicationVersion: app.getVersion(),
    version: '',
    credits: `By ${AUTHOR}\n${GITHUB_URL}`,
    copyright: `© ${new Date().getFullYear()} ${AUTHOR}`,
    website: GITHUB_URL,
    iconPath: join(app.getAppPath(), 'resources/icons/icon.png'),
  });

  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
        ...(mac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => BrowserWindow.getFocusedWindow()?.webContents.send(channel('window', 'edit'), 'undo') },
        { label: 'Redo', accelerator: mac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: () => BrowserWindow.getFocusedWindow()?.webContents.send(channel('window', 'edit'), 'redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, ...(mac ? [{ role: 'zoom' as const }, { type: 'separator' as const }, { role: 'front' as const }] : [])] },
    {
      role: 'help',
      submenu: [
        { label: 'Saturn on GitHub', click: () => void shell.openExternal(GITHUB_URL) },
        ...(mac ? [] : [{ role: 'about' as const, label: 'About Saturn' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
