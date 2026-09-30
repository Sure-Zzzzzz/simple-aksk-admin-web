import {
  applyTheme,
  createLightThemePreference,
  type ThemeSnapshot
} from '@sure-zzzzzz/simple-iam-theme-contract';

export type AkskThemeSnapshot = ThemeSnapshot;

export function createLightAkskThemeSnapshot(): AkskThemeSnapshot {
  return createLightThemePreference();
}

export function applyAkskTheme(root: HTMLElement, snapshot: AkskThemeSnapshot) {
  applyTheme(root, snapshot);
}
