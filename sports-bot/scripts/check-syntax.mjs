import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),files=['app.js','app.cjs'];
async function collect(directory){
 for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
  const name=join(directory,entry.name);
  if(entry.isDirectory())await collect(name);
  else if(entry.isFile()&&/\.(?:js|cjs|mjs)$/.test(entry.name))files.push(name);
 }
}
for(const directory of ['src','scripts','test','test-support'])await collect(directory);
for(const file of files.sort()){
 const result=spawnSync(process.execPath,['--check',join(root,file)],{windowsHide:true,encoding:'utf8'});
 if(result.error||result.status!==0){process.stderr.write(result.stderr||'Syntax process failed for '+relative(root,join(root,file))+'\n');process.exit(1);}
}
console.log('Syntax checked '+files.length+' project files.');
