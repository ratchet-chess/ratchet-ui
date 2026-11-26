/** One program this app ports from, follows or ships, with its license, as the About page lists it. */
export interface Credit {
  name: string;
  /** its public source; absent until it has one */
  url?: string;
  /** what this app takes from it */
  use: string;
  license: string;
}

/** The programs whose design or code this app follows, most first. */
export const followed: Credit[] = [
  {
    name: 'fastchess-gui',
    url: 'https://github.com/jromang/fastchess-gui',
    use: 'by Jean-François Romang: the model for the setup forms and presets, the tournament formats, standings and tiebreaks, the rating list, and the layout of the sections',
    license: 'MIT',
  },
  {
    name: 'fastchess',
    url: 'https://github.com/Disservin/fastchess',
    use: 'by Disservin and contributors: the SPRT and Elo code is ported from it; the adjudication and the PGN comments follow it',
    license: 'MIT',
  },
];

/** The libraries in the built app: each of package.json's dependencies, and the vendored host. */
export const libraries: Credit[] = [
  {
    name: 'chessground',
    url: 'https://github.com/lichess-org/chessground',
    use: 'the board',
    license: 'GPL-3.0-or-later',
  },
  {
    name: 'chessops',
    url: 'https://github.com/niklasf/chessops',
    use: 'the rules, FEN and PGN',
    license: 'GPL-3.0-or-later',
  },
  { name: 'vue', url: 'https://github.com/vuejs/core', use: 'the pages', license: 'MIT' },
  {
    name: 'vue-router',
    url: 'https://github.com/vuejs/router',
    use: 'the sections',
    license: 'MIT',
  },
  { name: 'pinia', url: 'https://github.com/vuejs/pinia', use: 'the stores', license: 'MIT' },
  {
    name: '@lucide/vue',
    url: 'https://github.com/lucide-icons/lucide',
    use: 'the icons',
    license: 'ISC',
  },
  {
    name: '@fontsource-variable/geist',
    url: 'https://fontsource.org/fonts/geist',
    use: 'the Geist UI typeface',
    license: 'OFL-1.1',
  },
  {
    name: 'uci-over-wasi',
    use: 'the host every engine runs in, copied into vendor/',
    license: 'MIT',
  },
  {
    name: 'lichess-org/chess-openings',
    url: 'https://github.com/lichess-org/chess-openings',
    use: 'opening names and ECO codes',
    license: 'CC0-1.0',
  },
];
