import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { channel } from '@shared/api';
import type { PageStyle } from '@shared/notebooks';
import type { WindowManager } from '../WindowManager';
import { isNotebookFolder, readNotebookMeta } from './Notebook';
import type { NotebookStore } from './NotebookStore';

export class NotebookIpc {
  constructor(private readonly store: NotebookStore, private readonly windows: WindowManager) {}

  register(): void {
    const handle = (name: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown) => ipcMain.handle(channel('notebooks', name), fn);
    const sender = (e: IpcMainInvokeEvent) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) throw new Error('IPC call from an unknown window');
      return win;
    };
    const open = async (path: string) => {
      await this.store.add(path);
      this.windows.openNotebook(path);
    };

    handle('list', () => this.store.list());
    handle('create', async (_e, name: string) => {
      const path = await this.store.create(name);
      this.windows.openNotebook(path);
      return path;
    });
    handle('openDialog', async (e) => {
      const picked = await dialog.showOpenDialog(sender(e), { title: 'Open a notebook folder', properties: ['openDirectory'] });
      const path = picked.canceled ? null : picked.filePaths[0];
      if (!path) return false;
      if (!isNotebookFolder(path)) throw new Error("That folder isn't a Saturn notebook");
      await open(path);
      return true;
    });
    handle('open', async (_e, path: string) => {
      if (!(await this.store.known(path))) throw new Error('Only notebooks in the list can be opened here');
      await open(path);
    });
    handle('remove', (_e, path: string) => this.store.remove(path));
    handle('delete', async (_e, path: string) => {
      if (!(await this.store.known(path))) throw new Error('Only notebooks in the list can be deleted here');
      if (this.windows.editorFor(path)) throw new Error('Close the notebook before deleting it');
      await shell.trashItem(path);
      await this.store.remove(path);
    });
    handle('name', (e) => {
      const path = this.windows.projectOf(sender(e));
      return path ? readNotebookMeta(path).then((m) => m.name) : null;
    });
    handle('folder', () => this.store.folder());
    handle('chooseFolder', async (e) => {
      const picked = await dialog.showOpenDialog(sender(e), { title: 'Where should new notebooks go?', properties: ['openDirectory', 'createDirectory'] });
      return picked.canceled || !picked.filePaths[0] ? this.store.folder() : this.store.setFolder(picked.filePaths[0]);
    });
    handle('resetFolder', () => this.store.setFolder(null));
    handle('style', () => this.store.style());
    handle('setStyle', (_e, style: PageStyle) => this.store.setStyle(style));
    handle('countIn', async (_e, folder: string) => (await this.store.inFolder(folder)).length);
    handle('moveFrom', (_e, folder: string) => this.store.moveFrom(folder, (path) => !!this.windows.editorFor(path)));
    handle('openSettings', (e) => this.windows.openSettings(sender(e), 'notebooks'));
  }
}
