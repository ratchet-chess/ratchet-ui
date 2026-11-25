<script setup lang="ts">
/**
 * Opening book picker: Start position plus every book in browser, with a link to Books when none
 * are loaded. `sm` fits the compact Play panel.
 */
import { useBooks } from '../stores/books.ts';

defineProps<{ size?: 'sm'; disabled?: boolean }>();
const model = defineModel<string>({ required: true });
const books = useBooks();
</script>

<template>
  <div class="min-w-0">
    <select
      v-model="model"
      :class="size === 'sm' ? 'field-sm num w-full' : 'field num w-60 max-w-full'"
      :disabled="disabled"
    >
      <option value="">Start position</option>
      <option v-for="b in books.usable" :key="b.id" :value="b.id">{{ b.id }}</option>
    </select>
    <div
      v-if="books.loaded && !books.error && books.usable.length === 0"
      class="mt-1 text-small text-dim"
    >
      No books in browser — add in
      <RouterLink to="/books" class="text-accent hover:underline">Books</RouterLink>
    </div>
  </div>
</template>
