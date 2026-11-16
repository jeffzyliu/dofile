import fs from "node:fs"; import path from "node:path";
const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()) w(p); else if(/\.(tsx?)$/.test(e.name)) files.push(p);}})("src");
const fns=[]; const imp={}, inb={};
for(const f of files){const L=fs.readFileSync(f,"utf8").split("\n");
 for(let i=0;i<L.length;i++){const l=L[i]; let m=l.match(/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)/)||l.match(/^(\s*)(?:export\s+)?const\s+(\w+)(?::[^=]+)?\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)(?::[^=]+)?\s*=>/)||l.match(/^(\s+)(?:(?:static|async|get|set|private|public|readonly)\s+)*#?(\w+)\s*\([^)]*\)(?::\s*[^{]+)?\s*\{\s*$/);
  if(!m||["if","for","while","switch","catch","return"].includes(m[2])) continue; const ind=m[1]; let j=i; 
  // find end: first line after i with same indent starting with } or ) 
  if(/\{\s*$/.test(l)||/=>\s*\{?\s*$/.test(l)||/\($/.test(l)||!/;\s*$/.test(l)){ for(j=i+1;j<L.length;j++){ if(L[j].startsWith(ind)&&/^\s*[}\)]/.test(L[j])&&L[j].match(/^\s*/)[0]===ind) break;} } 
  fns.push([j-i+1,m[2],f.replace("src/",""),i+1]);}
 const src=L.join("\n"); const ms=[...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g)]; const set=new Set();
 for(const x of ms){let t=path.normalize(path.join(path.dirname(f),x[1])); for(const c of [t,t+".ts",t+".tsx",t+"/index.ts",t.replace(/\.js$/,".ts")]) if(fs.existsSync(c)&&fs.statSync(c).isFile()){set.add(c);break;}}
 imp[f]=set; for(const t of set) (inb[t]??=new Set()).add(f);}
fns.sort((a,b)=>b[0]-a[0]); console.log("TOP 25 FUNCTIONS (lines | name | file:line)"); for(const x of fns.slice(0,25)) console.log(`${x[0]} | ${x[1]} | ${x[2]}:${x[3]}`);
console.log("\nIMPORTS MOST (local modules)"); for(const [f,s] of Object.entries(imp).sort((a,b)=>b[1].size-a[1].size).slice(0,10)) console.log(`${s.size} | ${f}`);
console.log("\nIMPORTED BY MOST"); for(const [f,s] of Object.entries(inb).sort((a,b)=>b[1].size-a[1].size).slice(0,10)) console.log(`${s.size} | ${f}`);
