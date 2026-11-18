import { createRouter, createWebHashHistory } from 'vue-router';
import BooksView from './views/BooksView.vue';
import EnginesView from './views/EnginesView.vue';
import GamesView from './views/GamesView.vue';
import JobsView from './views/JobsView.vue';
import LaterView from './views/LaterView.vue';
import PlayView from './views/PlayView.vue';
import SettingsView from './views/SettingsView.vue';
import StyleView from './views/StyleView.vue';
import TournamentsView from './views/TournamentsView.vue';

// Hash history, because a static host such as GitHub Pages cannot route a deep path to the app.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/jobs' },
    { path: '/jobs', component: JobsView },
    { path: '/engines', component: EnginesView },
    { path: '/play', component: PlayView },
    { path: '/books', component: BooksView },
    { path: '/tournaments/:id?', component: TournamentsView },
    { path: '/games/:id?/:game?', component: GamesView },
    { path: '/settings', component: SettingsView },
    { path: '/style', component: StyleView },
    {
      path: '/:section(hosts|ratings)',
      component: LaterView,
      props: true,
    },
  ],
});
