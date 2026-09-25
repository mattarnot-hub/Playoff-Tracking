export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'spray.theme';

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignore */
  }
  return 'auto';
}

/** Sets data-theme on <html> (none = follow the phone) and matches the iOS status bar colour. */
export function applyTheme(choice: ThemeChoice = getTheme()) {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
  const dark = choice === 'dark' || (choice === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1511' : '#e8f0e4');
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* ignore */
  }
  applyTheme(choice);
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
