// Polotno v4 detects its color scheme from `data-polotno-theme` on <html>
// (its PortalScope observes the attribute, so portal-rendered menus follow).
// The desktop app tracks the OS theme.
export function installThemeSync(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    document.documentElement.dataset.polotnoTheme = query.matches ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', query.matches)
  }
  apply()
  query.addEventListener('change', apply)
}
