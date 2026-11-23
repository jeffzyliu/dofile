// The hook's `state` object as one namespace, for the tests: `S.engine`, `S.log`, `S.showToast`, ...
// Import it with `await import` after the test has set the globals the modules read at load (localStorage, matchMedia).

const { hookState } = await import("../src/app/hook-state.ts");

export const S = hookState();
