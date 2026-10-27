import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

export interface LaunchedApp {
  app: ElectronApplication;
  userData: string;
}

/** Launches with a fresh profile that has already seen the first-launch welcome popup. */
export async function launchSaturn(userData = mkdtempSync(join(tmpdir(), 'saturn-data-'))): Promise<LaunchedApp> {
  const settings = join(userData, 'settings.json');
  if (!existsSync(settings)) writeFileSync(settings, JSON.stringify({ themeId: 'saturn', mode: 'dark', onboarded: true }));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SATURN_USER_DATA: userData },
  });
  return { app, userData };
}
