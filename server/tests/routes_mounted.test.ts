import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import customerRoutes from '../routes/customer.routes.ts';

const here=path.dirname(fileURLToPath(import.meta.url));

test('every route file is mounted in server.ts (Jarvis was not, so its settings could not be saved)',()=>{
 const server=fs.readFileSync(path.join(here,'..','..','server.ts'),'utf8');
 for(const file of fs.readdirSync(path.join(here,'..','routes')).filter(f=>f.endsWith('.routes.ts'))){
  const name=file.replace(/\.ts$/,'');
  assert.ok(server.includes(`./server/routes/${file}`),`${file} is not imported in server.ts`);
  const imported=new RegExp(`import (\\w+) from './server/routes/${name.replace('.','\\.')}\\.ts'`).exec(server)![1];
  assert.match(server,new RegExp(`app\\.use\\('/api[^']*', ${imported}\\)`),`${file} is imported but not mounted`);
 }
 assert.match(server,/app\.use\('\/api', \(req, res\)/,'unknown API paths answer 404 JSON, not the web page');
});

test('fixed customer paths are declared before "/:id", which would swallow them',()=>{
 const paths=(customerRoutes as any).stack.filter((l:any)=>l.route).map((l:any)=>l.route.path);
 const id=paths.indexOf('/:id');
 assert.ok(id>=0);
 assert.ok(paths.indexOf('/overdue-debts-summary')<id,'overdue-debts-summary comes after /:id');
});
