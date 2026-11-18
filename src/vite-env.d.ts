/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // oxlint-disable-next-line typescript/no-explicit-any -- this shim is for the linter's plain TypeScript program, which can't read .vue files; vue-tsc checks the real component types
  const component: DefineComponent<object, object, any>;
  export default component;
}
