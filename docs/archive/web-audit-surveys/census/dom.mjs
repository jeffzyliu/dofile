import fs from "node:fs"; import path from "node:path";
const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()) w(p); else if(/\.(tsx?|css)$/.test(e.name)&&!p.endsWith("commands.json")) files.push(p);}})("src");
const pats={focus:/\.focus\(/,blur:/\.blur\(/,query:/querySelector|getElementById|closest\(/,timer:/setTimeout|setInterval/,raf:/requestAnimationFrame|queueMicrotask/,addEL:/addEventListener/,rmEL:/removeEventListener/,effect:/\buse(Layout)?Effect\(/,ref:/\buseRef\b/,cast:/as any\b|as unknown as|@ts-expect-error|biome-ignore/,todo:/TODO|FIXME|XXX|HACK/,old:/step [0-9]|\bpoc\b|proof of concept|prototype|#[0-9]{1,3}\b/i};
const rows={}, all=[];
for(const f of files.filter(f=>/\.tsx?$/.test(f))){const src=fs.readFileSync(f,"utf8"); const lines=src.split("\n"); const r={}; rows[f]=r;
 lines.forEach((l,i)=>{for(const [k,re] of Object.entries(pats)) if(re.test(l)){r[k]=(r[k]||0)+1; all.push(`${k}\t${f}:${i+1}\t${l.trim().slice(0,140)}`);}});
 // effects without dep array: find useEffect( ... matching close paren; dep array = last arg ends with ], 
 let noDep=0; const re=/\buse(Layout)?Effect\(/g; let m; while((m=re.exec(src))){let d=1,i=m.index+m[0].length; while(i<src.length&&d>0){const c=src[i]; if(c==="(")d++; else if(c===")")d--; i++;} const body=src.slice(m.index,i).trimEnd(); if(!/\],?\s*\)$/.test(body)){noDep++; all.push(`effect-nodeps\t${f}:${src.slice(0,m.index).split("\n").length}\t`);}} if(noDep) r.effNoDep=noDep;
 if(r.addEL&&!r.rmEL) r.addNoRm=1;}
fs.writeFileSync(process.argv[2]+"/dom-matches.tsv",all.sort().join("\n"));
const keys=[...Object.keys(pats),"effNoDep","addNoRm"]; const tot={};
console.log("file | "+keys.join(" | ")); 
for(const [f,r] of Object.entries(rows)){ if(!Object.keys(r).length) continue; console.log(f.replace("src/","")+" | "+keys.map(k=>r[k]||"").join(" | ")); for(const k of keys) tot[k]=(tot[k]||0)+(r[k]||0);} console.log("TOTAL | "+keys.map(k=>tot[k]||0).join(" | "));
