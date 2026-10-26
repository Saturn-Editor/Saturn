import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

export interface LaunchedApp {
  app: ElectronApplication;
  userData: string;
}

export async function launchSaturn(userData = mkdtempSync(join(tmpdir(), 'saturn-data-'))): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SATURN_USER_DATA: userData },
  });
  return { app, userData };
}
