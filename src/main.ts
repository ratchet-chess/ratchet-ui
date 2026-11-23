import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { isolate } from './isolation.ts';
import { router } from './router.ts';
import './style.css';

// a first visit to a host without isolation headers reloads once, and the app starts after it
await isolate();
createApp(App).use(createPinia()).use(router).mount('#app');
