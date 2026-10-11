import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildXlsx,columnLetter} from '../utils/xlsx.ts';
import {db} from '../db/database.ts';
import {CashService} from '../services/cash.service.ts';

beforeEach(()=>{db.init();db.reset();});

/** Reads the entries of a zip written by buildXlsx (local headers, deflate). */
function unzip(buf:Buffer):Record<string,string>{
 const files:Record<string,string>={};let o=0;
 while(buf.readUInt32LE(o)===0x04034b50){
  const size=buf.readUInt32LE(o+18),nameLen=buf.readUInt16LE(o+26),extra=buf.readUInt16LE(o+28);
  const name=buf.subarray(o+30,o+30+nameLen).toString('utf8');
  const start=o+30+nameLen+extra;
  files[name]=inflateRawSync(buf.subarray(start,start+size)).toString('utf8');
  o=start+size;
 }
 return files;
}

test('workbook has every part, SUM totals with cached values, escaped text and negative money',()=>{
 const files=unzip(buildXlsx([{name:'Reestr/1',title:'Kassa',columns:[{header:'Mijoz',key:'c'},{header:'Summa',key:'s',type:'money',total:true}],rows:[{c:'A & <B>',s:100},{c:'Qarz',s:-40}],totalsLabel:'JAMI'}]));
 for(const part of ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/worksheets/sheet1.xml']) assert.ok(files[part],part);
 const sheet=files['xl/worksheets/sheet1.xml'];
 assert.match(sheet,/<f>SUM\(B4:B5\)<\/f><v>60<\/v>/);
 assert.match(sheet,/A &amp; &lt;B&gt;/);
 assert.match(sheet,/<v>-40<\/v>/);
 assert.match(sheet,/<autoFilter ref="A3:B5"\/>/);
 assert.match(files['xl/workbook.xml'],/name="Reestr 1"/,'invalid tab characters replaced');
 assert.equal(columnLetter(0),'A');assert.equal(columnLetter(27),'AB');
});

test('cash day export uses the register fields the cash screen shows',()=>{
 db.insert('companies',{id:'c',name:'Test MChJ'} as any);
 db.insert('cash_days',{id:'d',company_id:'c',date:'2026-09-30',status:'OPEN',opening_balance:5,cash_payment:0,terminal_payment:0,click_payment:0,credit_collection:0,calculated_closing_balance:5} as any);
 db.insert('customers',{id:'k',company_id:'c',code:'a0_1',name:'Do‘kon',phone:'',credit_limit:0,current_balance:0,status:'ACTIVE',is_active:true,created_at:''} as any);
 db.insert('daily_order_entries',{id:'e',company_id:'c',cash_day_id:'d',order_number:'77',order_date:'2026-09-30',customer_id:'k',sale_amount:1000,cash_payment:300,uy_oplata:200,nasiyadan_kirim:50,terminal_click:100,remaining_debt:400,created_at:''} as any);
 const [register,movements]=CashService.exportCashDaySheets('c','d');
 const row=register.rows[0] as any;
 assert.deepEqual([row.sale_amount,row.cash_payment,row.uy_oplata,row.nasiyadan_kirim,row.terminal_click,row.remaining_debt],[1000,300,200,50,100,400]);
 assert.equal(row.code,'a0_1');
 assert.ok(register.subtitle!.includes('Test MChJ'));
 assert.equal(movements.summary![0].value,5);
});
