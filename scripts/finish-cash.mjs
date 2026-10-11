import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('server/services/cash.service.ts',s=>{
 const a=s.indexOf('  public static createRegistryOrder');const b=s.indexOf('  public static updateRegistryOrder',a);let part=s.slice(a,b);
 part=part.replace('    company_id: string;', '    company_id: string;\n    cash_day_id?: string;');
 part=part.replace('    const today =',`    if(!db.findOne('customers',c=>c.id===dto.customer_id && c.company_id===dto.company_id)) throw new Error('Mijoz topilmadi');
    return db.transaction(()=>{
    const today =`);
 part=part.replace("    let cashDay = db.findOne('cash_days', cd => cd.company_id === dto.company_id && cd.date === today);", "    let cashDay = db.findOne('cash_days', cd => cd.company_id === dto.company_id && (dto.cash_day_id ? cd.id===dto.cash_day_id : cd.date === today));\n    if(dto.cash_day_id && !cashDay) throw new Error('Kassa kuni topilmadi');");
 part=part.replace(/    if \(!cashDay\) \{\n      \/\/ Find any open cash day[\s\S]*?\n    \}/,'');
 part=part.replace('    const orderId =', "    if(cashDay.status!=='OPEN' || cashDay.date!==today) throw new Error('Tanlangan kassa kuni yopiq yoki sana mos emas');\n    const orderId =");
 part=part.replace('    return orderEntry;\n  }', '    return this.updateRegistryOrder(orderEntry.id,dto.company_id,{...orderEntry},dto.user_id,dto.user_email);\n    });\n  }');
 s=s.slice(0,a)+part+s.slice(b);
 // Validate customer ownership even for updates.
 s=s.replace('    const merged={...existing,...dto};', "    const merged={...existing,...dto};\n    if(!db.findOne('customers',c=>c.id===merged.customer_id && c.company_id===company_id)) throw new Error('Mijoz topilmadi');");
 return s;
});
edit('server/routes/cash.routes.ts',s=>s.replace('      order_date: req.body.order_date,','      order_date: req.body.order_date,\n      cash_day_id:req.body.cash_day_id,'));
edit('src/components/views/CashView.tsx',s=>s.replace('        order_date: formData.order_date,','        cash_day_id:selectedFile?.id,\n        order_date: formData.order_date,'));
edit('server/integrations/provider.ts',s=>{
 const a=s.indexOf('  public async syncDayOrders');let part=s.slice(a);
 part=part.replace('    // Also look at existing sales_orders', '    return db.transaction(()=>{\n    // Also look at existing sales_orders');
 part=part.replace('    };\n  }\n}', '    };\n    });\n  }\n}');
 part=part.replace("if (integratedOrders.length === 0 && existingSalesOrders.length > 0)","if (!activeIntegration && existingSalesOrders.length > 0)");
 part=part.replace('e.cash_day_id === cashDayId && e.order_number === ord.orderNumber','e.cash_day_id === cashDayId && (e.external_order_id===ord.externalId || !e.external_order_id && e.order_number === ord.orderNumber)');
 // Re-import must not change an exported payment's identity or linked order.
 part=part.replace('      } else {\n        const debt=', "      } else {\n        if(db.findOne('integration_transactions',t=>t.payload?.rowId===entry!.id && ['PROCESSED','SENDING','UNCERTAIN'].includes(t.status))) continue;\n        const debt=");
 part=part.replace('          remaining_debt:debt,nasiya_perech:debt,credit_amount:debt,','          customer_id:cust.id,customer_name:cust.name,remaining_debt:debt,nasiya_perech:debt,credit_amount:debt,');
 return s.slice(0,a)+part;
});
