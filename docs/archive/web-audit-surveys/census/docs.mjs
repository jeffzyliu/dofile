import fs from "node:fs"; import path from "node:path";
const TR=fs.readFileSync(process.argv[2]+"/files.txt","utf8").split("\n"); const scripts=JSON.parse(fs.readFileSync("web/package.json","utf8")).scripts;
for(const [doc,base] of [["web/CLAUDE.md","web"],["web/README.md","web"],["docs/test-map.md","web"]]){
 const t=fs.readFileSync(doc,"utf8"); const bad=[];
 for(const m of t.matchAll(/`([^`\n]+)`/g)){const s=m[1].trim();
  const rn=s.match(/^npm run ([\w:-]+)/); if(rn){ if(!(rn[1] in scripts)) bad.push("SCRIPT "+s); continue;}
  if(/^(npm|npx|uv|git|node|cd|cp|rm)\s/.test(s)) continue;
  if(!/^[\w@.\/~-][\w.\/@*{}-]*\.(ts|tsx|mjs|js|css|md|json|html|jsonc|py|yml|yaml|toml|sh|png|svg|wasm|whl)$|^[\w.-]+(\/[\w.@*{}-]+)+\/?$/.test(s)) continue;
  if(/^https?:/.test(s)||s.includes("*")||s.includes("{")) continue;
  const cands=[s,path.join("web",s),path.join(path.dirname(doc),s),path.join("src/dofile",s),path.join("web/src",s),path.join("docs",s),path.join("tests",s)];
  if(!cands.some(c=>fs.existsSync(c))&&!TR.some(f=>f===s||f.endsWith("/"+s)||(s.endsWith("/")&&f.includes(s)))) bad.push("PATH "+s);}
 console.log(`== ${doc}: ${[...new Set(bad)].length} suspect`); console.log([...new Set(bad)].join("\n"));
}
