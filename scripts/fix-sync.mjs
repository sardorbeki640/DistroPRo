import fs from 'node:fs';
const edit=(p,f)=>{const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');fs.writeFileSync(p,f(s));};
edit('server/integrations/adapters/salesdoc.adapter.ts',s=>{
 s=s.replace("const rawProducts = await this.executeSalesDocMethod(config, 'getProduct', { limit: 1000, page: 1 });", "const rawProducts = { product: await this.readAll(config, 'getProduct', 'product') };");
 s=s.replace("const clientRes = await this.executeSalesDocMethod(config, 'getClient', { limit: 1000, page: 1 });", "const clientRes = { client: await this.readAll(config, 'getClient', 'client') };");
 s=s.replace("externalCode: c.code_1C || `SD-CUST-${c.SD_id || c.CS_id}`", "externalCode: String(c.code_1C || c.SD_id || c.CS_id)");
 s=s.replace(/          if \(sellingPrice > 0 && purchaseCost === 0\) \{[\s\S]*?          const dailySalesAvg = .*?;/, '          const dailySalesAvg = 0;');
 const a=s.indexOf('    const today =',s.indexOf('  public async importOrders('));
 const b=s.indexOf('      if (orders.length > 0)',a);
 s=s.slice(0,a)+`    const period = options?.dateFrom || options?.dateTo ? {
      [config.order_date_field === 'dateLoad' ? 'dateLoad' : 'date']: { from: options?.dateFrom, to: options?.dateTo }
    } : undefined;
    const orders = await this.readAll(config, 'getOrder', 'order', {
      promotions: true,
      filter: { include: 'all', agent: 'all', status: options?.status || [1,2,3,4,5], ...(period ? {period} : {}) }
    });
`+s.slice(b);
 s=s.replace("const rawStatus = Number(o.status) || 3;", "const rawStatus = Number(o.status);");
 s=s.replace("const status = statusMap[rawStatus] || (rawStatus <= 2 ? 'NEW' : 'DELIVERED');", "const status = statusMap[rawStatus] || 'UNKNOWN';");
 s=s.replace('Number(o.totalSummaAfterDiscount || o.totalSumma)', 'Number(o.totalSummaAfterDiscount ?? o.totalSumma)');
 s=s.replace('const quantity = Number(item.quantity) || Number(item.count) || 1;', 'const quantity = Math.max(0, Number(item.quantity ?? item.count ?? 0) - Number(item.returned ?? 0));');
 s=s.replace('const itemTotal = Number(item.totalSumma) || (quantity * price);', 'const itemTotal = Number(item.summa ?? item.totalSumma ?? (quantity * price));');
 s=s.replace("externalId: o.SD_id || o.CS_id || `SD-${o.code_1C || Math.random().toString(36).slice(2, 7)}`", "externalId: String(o.SD_id || o.CS_id || o.code_1C || (() => { throw new Error('Buyurtma ID yo‘q'); })())");
 s=s.replace('            customerCode,', `            customerCode: String(customerCode),
            customerRef: o.client?.code_1C ? {code_1C: String(o.client.code_1C)} : o.client?.SD_id ? {SD_id: String(o.client.SD_id)} : {CS_id: String(o.client?.CS_id)},
            orderRef: o.SD_id ? {SD_id: String(o.SD_id)} : {code_1C: String(o.code_1C)},
            paymentTypeRef: o.paymentType?.SD_id ? {SD_id: String(o.paymentType.SD_id)} : o.paymentType?.code_1C ? {code_1C: String(o.paymentType.code_1C)} : undefined,`);
 s=s.replace('(o.dateDocument || o.dateCreate || o.orderCreated || today)', "(o.dateDocument || o.dateCreate || o.orderCreated || '')");
 s=s.replace(/    \} catch \(err: any\) \{\n      console.warn\('\[SalesDocAdapter\] importOrders API call failed:', err.message\);\n    \}/, '');
 s=s.replace("      console.warn('[SalesDocAdapter] importProducts API call failed:', err.message);", '      throw err;');
 s=s.replace("      console.warn('[SalesDocAdapter] importCustomers API call failed:', err.message);", '      throw err;');
 return s;
});
edit('server/integrations/interfaces.ts',s=>s.replace('  customerCode: string;', '  customerRef?: Record<string, string>;\n  orderRef?: Record<string, string>;\n  paymentTypeRef?: Record<string, string>;\n  customerCode: string;'));
edit('server/db/schema.ts',s=>s.replace('export interface DailyOrderEntry {', `export interface DailyOrderEntry {
  integration_id?: string;
  external_order_id?: string;
  customer_ref?: Record<string, string>;
  order_ref?: Record<string, string>;
  payment_type_ref?: Record<string, string>;`).replace("  status: 'PENDING' | 'PROCESSED' | 'FAILED';", "  status: 'PENDING' | 'PROCESSED' | 'FAILED' | 'SENDING' | 'UNCERTAIN';"));
