import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { launchSaturn } from './app';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('launches to the Welcome screen', async () => {
  const { app } = await launchSaturn();
  const page = await app.firstWindow();
  await expect(page).toHaveTitle('Saturn');
  await expect(page.getByTestId('screen-welcome')).toBeVisible();
  await app.close();
});

test('settings switches the theme live', async () => {
  const { app } = await launchSaturn();
  const welcome = await app.firstWindow();
  await welcome.getByRole('button', { name: 'Settings' }).click();
  const settings = await app.waitForEvent('window');
  await settings.getByRole('radio', { name: /Saturn Light/ }).click();
  await expect(welcome.locator('html')).toHaveAttribute('data-theme-type', 'light');
  await settings.getByRole('radio', { name: /Saturn Dark/ }).click();
  await expect(welcome.locator('html')).toHaveAttribute('data-theme-type', 'dark');
  await app.close();
});

async function createProject(): Promise<{ editor: Page; projectDir: string; close: () => Promise<void> }> {
  const parent = mkdtempSync(join(tmpdir(), 'saturn proj '));
  const { app } = await launchSaturn();
  const welcome = await app.firstWindow();
  await welcome.getByTestId('welcome-new').click();
  const dialog = await app.waitForEvent('window');
  await dialog.getByTestId('new-name').fill('demo');
  await dialog.getByTestId('new-location').fill(parent);
  const editorPromise = app.waitForEvent('window');
  await dialog.getByTestId('new-create').click();
  const editor = await editorPromise;
  await expect(editor.getByTestId('screen-editor')).toBeVisible();
  return { editor, projectDir: join(parent, 'demo'), close: () => app.close() };
}

test('create a project, edit and save a file', async () => {
  const { editor, projectDir, close } = await createProject();
  writeFileSync(join(projectDir, 'hello.txt'), '');
  await expect(editor.getByTestId('panel-project')).toBeVisible();
  await editor.getByRole('treeitem', { name: 'hello.txt' }).dblclick();
  await editor.locator('.cm-content').click();
  await editor.keyboard.type('Hi');
  await expect(editor.getByTestId('dirty-dot')).toBeVisible();
  await editor.keyboard.press(`${MOD}+s`);
  await expect(editor.getByTestId('dirty-dot')).toHaveCount(0);
  expect(readFileSync(join(projectDir, 'hello.txt'), 'utf8')).toBe('Hi');
  await expect(editor.getByTestId('status-file')).toContainText('Plain Text');
  await close();
});

test('panels toggle and move between docks', async () => {
  const { editor, close } = await createProject();
  await editor.getByTestId('strip-project').getByRole('button').click();
  await expect(editor.getByTestId('panel-project')).toHaveCount(0);
  await editor.getByTestId('strip-terminal').getByRole('button').click();
  await expect(editor.getByTestId('panel-terminal')).toBeVisible();
  await editor.getByTestId('strip-terminal').dragTo(editor.getByTestId('strip-top'));
  await expect(editor.getByTestId('strip-top').getByTestId('strip-terminal')).toBeVisible();
  await close();
});

test('terminal runs commands and Run executes a custom command', async () => {
  const { editor, close } = await createProject();
  await editor.getByTestId('strip-terminal').getByRole('button').click();
  await expect(editor.getByTestId('terminal-view')).toBeVisible();
  // Wait for the shell prompt; keys typed before the shell is ready get garbled by its line editor.
  await expect(editor.locator('.xterm-rows')).not.toHaveText(/^\s*$/);
  await editor.waitForTimeout(500);
  await editor.getByTestId('terminal-view').click();
  await editor.keyboard.type('echo saturn-ok\n');
  await expect(editor.locator('.xterm-rows')).toContainText('saturn-ok');

  await editor.getByTestId('run-select').click();
  await editor.getByTestId('run-add').click();
  await editor.getByTestId('run-name').fill('Echo');
  await editor.getByTestId('run-command').fill('echo run-ok');
  await editor.getByTestId('run-save').click();
  await editor.getByTestId('run-start').click();
  await expect(editor.getByRole('tab', { name: /Echo/ })).toBeVisible();
  await expect(editor.locator('.xterm-rows')).toContainText('run-ok');
  await close();
});

test('action search runs a command', async () => {
  const { editor, close } = await createProject();
  await editor.keyboard.press(`${MOD}+Shift+a`);
  await editor.keyboard.type('toggle term');
  await editor.keyboard.press('Enter');
  await expect(editor.getByTestId('panel-terminal')).toBeVisible();
  await close();
});
