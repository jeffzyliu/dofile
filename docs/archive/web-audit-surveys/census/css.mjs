import fs from "node:fs"; import path from "node:path"; import {execSync} from "node:child_process";
const corpusFiles=execSync(`find src scripts e2e ../docs/design test -type f ! -name '*.json' ! -name '*.png' ! -name '*.woff2' ! -name '*.wasm' ! -name '*.svg' ! -name '*.whl' ! -name '*.br' ! -name '*.css'; ls *.html`,{encoding:"utf8"}).split("\n").filter(Boolean);
const corpus=corpusFiles.map(f=>fs.readFileSync(f,"utf8")).join("\n");
const out=[];
for(const f of ["src/styles/ui.css","src/styles/app.css","src/site/site.css"]){ if(!fs.existsSync(f)){out.push(`MISSING ${f}`);continue;} const css=fs.readFileSync(f,"utf8").replace(/\/\*[\s\S]*?\*\//g,"").replace(/url\([^)]*\)/g,""); const cls=[...new Set([...css.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(m=>m[1]))].filter(c=>!/^\d/.test(c)); const un=cls.filter(c=>!new RegExp("(?<![\\w-])"+c.replace(/[-]/g,"\\-")+"(?![\\w-])").test(corpus)); out.push(`${f}: ${cls.length} classes, ${un.length} unreferenced: ${un.join(" ")}`);}
const tok=fs.readFileSync("src/styles/tokens.css","utf8"); const defs=[...new Set([...tok.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]))];
const allcss=["src/styles/ui.css","src/styles/app.css","src/site/site.css","src/styles/tokens.css"].map(f=>fs.readFileSync(f,"utf8")).join("\n")+corpus;
const unv=defs.filter(v=>{const re=new RegExp("var\\(\\s*"+v+"(?![\\w-])"); const re2=new RegExp(v+"(?![\\w-])","g"); if(re.test(allcss)) return false; // used by name elsewhere (non-definition)?
 const hits=(allcss.match(re2)||[]).length; const defHits=(tok.match(new RegExp(v+"\\s*:","g"))||[]).length; return hits<=defHits;});
out.push(`tokens.css: ${defs.length} custom properties, ${unv.length} never var()-used: ${unv.join(" ")}`);
console.log(out.join("\n"));
