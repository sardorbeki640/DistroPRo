import fs from 'node:fs';
const edit=(f,fn)=>fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')));
edit('src/components/Header.tsx',s=>{const a=s.indexOf('              {/* Developer Fast Role Switcher */}');const b=s.indexOf('              <div className="border-t border-neutral-100 pt-1">',a);return s.slice(0,a)+s.slice(b);});
edit('src/components/views/BalanceView.tsx',s=>{for(const name of ['current_ratio','cash_ratio','debt_to_equity_ratio'])s=s.replace(`{balanceData.indicators.${name}}x`,`{balanceData.indicators.${name} == null ? "Ma’lumot yo‘q" : balanceData.indicators.${name} + "x"}`);return s;});
edit('server/services/notification.service.ts',s=>s.replace('Telegram botga yuborildi.','mahalliy navbatga yozildi. Telegram orqali yetkazish xizmati ulanmagan.'));
