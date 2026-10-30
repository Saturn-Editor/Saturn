import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { channel } from '@shared/api';
import type { PageFile, PageStyle } from '@shared/notebooks';
import type { NotebookCrypto } from './NotebookCrypto';
import type { WindowManager } from '../WindowManager';
import { isNotebookFolder, readNotebookMeta, writeNotebookName } from './Notebook';
import type { NotebookStore } from './NotebookStore';

export class NotebookIpc {
  constructor(private readonly store: NotebookStore, private readonly windows: WindowManager, private readonly crypto: NotebookCrypto) {}

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
    const root = (e: IpcMainInvokeEvent) => {
      const path = this.windows.projectOf(sender(e));
      if (!path) throw new Error('No notebook is open in this window');
      return path;
    };
    handle('rename', async (e, name: string) => {
      const title = name.trim();
      if (!title) throw new Error('Give the notebook a name');
      const path = root(e);
      await writeNotebookName(path, title);
      await this.store.touch(path, title);
      return title;
    });
    handle('lockState', (e) => this.crypto.state(root(e)));
    handle('unlock', (e, password: string, remember: boolean) => this.crypto.unlock(root(e), password, remember));
    handle('lock', (e) => this.crypto.lock(root(e)));
    handle('encrypt', (e, password: string, remember: boolean) => this.crypto.enable(root(e), password, remember));
    handle('decrypt', (e, password: string) => this.crypto.disable(root(e), password));
    handle('changePassword', (e, current: string, next: string) => this.crypto.changePassword(root(e), current, next));
    handle('readPage', (e, path: string) => this.crypto.readPage(root(e), path));
    handle('pageTitles', (e) => this.crypto.titles(root(e)));
    handle('createPage', (e, dir: string, title: string) => this.crypto.createPage(root(e), dir, title));
    handle('setPageTitle', (e, path: string, title: string) => this.crypto.setTitle(root(e), path, title));
    handle('writePage', (e, path: string, page: PageFile) => this.crypto.writePage(root(e), path, page));
  }
}
