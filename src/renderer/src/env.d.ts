import type { SaturnApi } from '@shared/api';

declare global {
  /** The app version from package.json, injected at build time. */
  const __SATURN_VERSION__: string;

  interface Window {
    saturn: SaturnApi;
  }
}
