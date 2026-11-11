declare const __WHEEL__: string;     // the dofile wheel's file name, served next to the page
declare const __EXTRA_WHEELS__: string[];   // file names of web/wheels/*.whl (pyreadstat), served next to the page
declare const __BUILD_ID__: string;   // the build id (scripts/build-id.ts); start-files.json must carry the same (client.ts, checkBuild)
declare const __PYODIDE__: string;   // Pyodide's indexURL (CDN)
// what the build says of the engine (scripts/build-id.ts, about()): the package's version, the engine's commit, the Stata version
declare const __ABOUT__: { dofile: string; engine_commit: string | null; stata_version: number };
