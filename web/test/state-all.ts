// The page's state modules as one namespace, for the tests: `S.engine`, `S.log`, `S.showToast`, ... as one module held them.
// Import it with `await import` after the test has set the globals the modules read at load (localStorage, matchMedia).

const { theme, resolvedTheme } = await import("../src/app/theme.ts");
const { pickedVar } = await import("../src/app/output/view.ts");

export const S = {
  theme,
  resolvedTheme,
  pickedVar,
  ...(await import("../src/app/state/saved.ts")),
  ...(await import("../src/app/state/notices.ts")),
  ...(await import("../src/app/state/layout.ts")),
  ...(await import("../src/app/state/run.ts")),
  ...(await import("../src/app/state/files.ts")),
  ...(await import("../src/app/state/engine.ts")),
};
