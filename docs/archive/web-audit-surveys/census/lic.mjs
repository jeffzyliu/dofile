import fs from "node:fs";
const root = process.cwd();
const pj = JSON.parse(fs.readFileSync("package.json","utf8"));
const lic = (p)=>{ try{const j=JSON.parse(fs.readFileSync(`node_modules/${p}/package.json`,"utf8")); let l=j.license??(j.licenses?JSON.stringify(j.licenses):"UNKNOWN"); if(typeof l==="object") l=l.type; return [j.version,l];}catch{return ["?","MISSING"]}};
for (const k of ["dependencies","devDependencies"]) for (const p of Object.keys(pj[k])) console.log(k.slice(0,3), p, ...lic(p));
const lock = JSON.parse(fs.readFileSync("node_modules/.package-lock.json","utf8")).packages;
const h={}; const flag=[]; let n=0;
for (const [path,v] of Object.entries(lock)) { if(!path) continue; n++; let l=v.license; if(l&&typeof l==="object") l=l.type; if(!l){ try{const j=JSON.parse(fs.readFileSync(path+"/package.json","utf8")); l=j.license?.type??j.license??(j.licenses?.[0]?.type)}catch{} } l=l??"UNKNOWN"; h[l]=(h[l]||0)+1; if(/GPL|UNKNOWN|UNLICENSED|SEE LICENSE/i.test(l)) flag.push(path.replace("node_modules/","")+" "+l+(v.dev?" dev":" prod")); }
console.log("TOTAL",n); console.log(Object.entries(h).sort((a,b)=>b[1]-a[1]).map(e=>e.join(": ")).join("\n")); console.log("FLAGGED"); console.log(flag.join("\n"));
