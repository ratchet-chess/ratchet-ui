import { onBeforeUnmount, watchEffect } from 'vue';
import { useSettings } from '../stores/settings.ts';

/**
 * Keeps the page's theme to the setting: light or dark, or the system's, followed as it changes.
 * style.css reads `data-theme` on the root element.
 */
export function useTheme(): void {
  const settings = useSettings();
  const system = matchMedia('(prefers-color-scheme: light)');
  const apply = () => {
    const light = settings.theme === 'light' || (settings.theme === 'system' && system.matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
  };
  watchEffect(apply);
  system.addEventListener('change', apply);
  onBeforeUnmount(() => system.removeEventListener('change', apply));
}
