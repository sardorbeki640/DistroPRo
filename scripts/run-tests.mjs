import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
const runs=path.join(root,'.test-runs');fs.mkdirSync(runs,{recursive:true});
const run=fs.mkdtempSync(path.join(runs,'run-'));
let failed=false;
for(const file of fs.readdirSync(path.join(root,'server/tests')).filter(f=>f.endsWith('.test.ts'))){
 const dir=path.join(run,file);fs.mkdirSync(dir);
 const result=spawnSync(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'--test',path.join(root,'server/tests',file)],{cwd:dir,env:{...process.env,NODE_ENV:'test',FINANCE_DATA_DIR:path.join(dir,'.data')},encoding:'utf8'});
 fs.writeFileSync(path.join(dir,'result.log'),(result.stdout||'')+(result.stderr||''));
 console.log(`${result.status===0?'PASS':'FAIL'} ${file}`);
 if(result.status!==0){failed=true;console.log(result.stdout,result.stderr);}
}
console.log(`Test logs: ${run}`);
process.exitCode=failed?1:0;
