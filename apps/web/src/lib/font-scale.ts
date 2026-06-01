import { getFontScale } from './prefs';

export function applyFontScale(scale: number): void {
  document.documentElement.style.fontSize = `${scale}%`;
}

export function initFontScale(): void {
  applyFontScale(getFontScale());
}
