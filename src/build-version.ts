export interface BuildIdentity { id: string; version: string; commit: string; fingerprint: string; channel: 'dev' | 'preview' | 'release'; label: string }
declare const __APP_BUILD__: BuildIdentity;
/** Vite injects this once into each bundle, so an already-open tab retains its actual version. */
export const APP_BUILD: BuildIdentity = typeof __APP_BUILD__ === 'undefined'
  ? { id: 'test.unbundled', version: 'test', commit: 'unbundled', fingerprint: '', channel: 'dev', label: 'テスト版' }
  : __APP_BUILD__;
