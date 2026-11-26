/** What the notices check tournaments against, from this browser's engines, books and storage. */
import { computed, type ComputedRef } from 'vue';
import { useBooks } from '../../stores/books.ts';
import { useEngines } from '../../stores/engines.ts';
import type { Served } from './overview.ts';

export function useServed(): ComputedRef<Served> {
  const engines = useEngines();
  const books = useBooks();
  return computed(() => ({
    engines: new Set(engines.list.map((e) => e.id)),
    books: new Set(books.usable.map((b) => b.id)),
    storage: books.storage,
  }));
}
