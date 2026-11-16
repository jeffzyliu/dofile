import fs from "node:fs"; import path from "node:path"; import {execSync} from "node:child_process";
const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()) w(p); else if(/\.(tsx?)$/.test(e.name)) files.push(p);}})("src");
const rows=[];
for(const f of files){const L=fs.readFileSync(f,"utf8").split("\n"); if(L.length<=100) continue; let c=0,inb=false;
 for(const l of L){const t=l.trim(); if(inb){c++; if(t.includes("*/")) inb=false; continue;} if(t.startsWith("//")) c++; else if(t.startsWith("/*")){c++; if(!t.includes("*/")) inb=true;} else if(/\s\/\/ /.test(l)&&!/["'`].*\/\/.*["'`]/.test(l)) c+=0.0;}
 let h=0,i=0; while(i<L.length&&(L[i].trim()===""||L[i].startsWith("#!"))) i++; let s=i; let ib=false; for(;i<L.length;i++){const t=L[i].trim(); if(ib){h++; if(t.includes("*/")) ib=false; continue;} if(t.startsWith("//")) h++; else if(t.startsWith("/*")){h++; if(!t.includes("*/")) ib=true;} else break;}
 rows.push({f,n:L.length,c,h,end:s+h});}
rows.sort((a,b)=>b.h-a.h);
console.log("file | lines | comment lines | header lines");
for(const r of rows) console.log(`${r.f.replace("src/","")} | ${r.n} | ${r.c} | ${r.h}`);
console.log("\nCHURN top15 header (commits in last 60 touching file that changed header block)");
for(const r of rows.slice(0,15)){ if(!r.h){continue;} const abs=`web/${r.f}`; let out="err"; try{ const base=execSync(`git log -60 --format=%h -- ${abs}`,{cwd:"..",encoding:"utf8"}).trim().split("\n"); const oldest=base[base.length-1]; out=execSync(`git log -L1,${r.end}:${abs} --oneline ${oldest}^..HEAD`,{cwd:"..",encoding:"utf8",stdio:["ignore","pipe","ignore"]}).split("\n").filter(l=>/^[0-9a-f]{7,}\s/.test(l)).length+" of "+base.length;}catch(e){out="err "+String(e.message).slice(0,60)} console.log(`${r.f} header=${r.h} -> ${out}`);}
