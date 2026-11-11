declare const __WHEEL__: string;     // the dofile wheel's file name, served next to the page
declare const __EXTRA_WHEELS__: string[];   // file names of web/wheels/*.whl (pyreadstat), served next to the page
declare const __WHEEL_HASH__: string;   // SHA-256 of that wheel; start-files.json must carry the same (client.ts, checkBuild)
declare const __PYODIDE__: string;   // Pyodide's indexURL (CDN)
