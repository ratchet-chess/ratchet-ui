import type { Component } from 'vue';
import {
  BookOpen,
  ChartLine,
  ChessKnight,
  Cpu,
  FileText,
  ListChecks,
  Server,
  Settings,
  Trophy,
} from '@lucide/vue';

/** One section of the app: a page, and its icon in the bar. */
export interface Section {
  path: string;
  label: string;
  icon: Component;
  /** true when the section reads the manager, so it shows nothing until one is connected */
  manager: boolean;
}

/** The bar's order; manager sections stay hidden until a manager URL is set in Settings. */
export const sections: Section[] = [
  { path: '/play', label: 'Play', icon: ChessKnight, manager: false },
  { path: '/tournaments', label: 'Tourneys', icon: Trophy, manager: false },
  { path: '/games', label: 'Games', icon: FileText, manager: false },
  { path: '/engines', label: 'Engines', icon: Cpu, manager: false },
  { path: '/books', label: 'Books', icon: BookOpen, manager: false },
  { path: '/ratings', label: 'Ratings', icon: ChartLine, manager: false },
  { path: '/jobs', label: 'Jobs', icon: ListChecks, manager: true },
  { path: '/hosts', label: 'Hosts', icon: Server, manager: true },
  { path: '/settings', label: 'Settings', icon: Settings, manager: false },
];
