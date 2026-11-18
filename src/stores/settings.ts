import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const MANAGER_KEY = 'ratchet-ui.manager';

/** The app's settings that outlive a reload. They are a few short strings, so localStorage holds them. */
export const useSettings = defineStore('settings', () => {
  /** the manager's address, such as http://host:port; empty when none is set */
  const managerUrl = ref(localStorage.getItem(MANAGER_KEY) ?? '');
  watch(managerUrl, (url) => {
    if (url) localStorage.setItem(MANAGER_KEY, url);
    else localStorage.removeItem(MANAGER_KEY);
  });
  return { managerUrl };
});
