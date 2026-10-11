# Distro Pro — tekshiruv natijasi

Sana: 2026-09-27. Manba: dstro-pro-moliya-tizimi.zip. Mahalliy nusxa http://127.0.0.1:3100 da ishga tushirildi. Bu dastur hozir haqiqiy moliyani ishonchli boshqarishga tayyor emas. Quyida kuzatilgan yoki kod/sun'iy ma'lumot bilan tasdiqlangan muammolar berilgan.

## Birinchi navbatdagi xatolar

1. **Balansda bank puli o'ylab hisoblanadi.** `server/services/analytics.service.ts:355` terminal va Click tushumlarining 65 foizini bank qoldig'i deb oladi. Bank kirim-chiqimlari reestri yo'q. Sinovda 1 000 000 tushumdan 650 000 qoldiq chiqdi. Yechim: bank hisobvaraqlari va haqiqiy tranzaksiyalar asosidagi qoldiq.
2. **Tarixiy balans kelajak ma'lumotini qo'shadi.** Shu funksiyada kassa, bank, mijoz balansi, ombor va oyliklar tanlangan sana bilan izchil cheklanmagan. 2026-yildagi tushum 2020-01-01 balansiga 650 000 bo'lib kirdi (review-probes.log). Yechim: har bir aktiv va majburiyatni berilgan sanagacha bo'lgan reestrdan hisoblash.
3. **Yetkazib beruvchi qarzi doim nol.** `analytics.service.ts:384`: accountsPayable = 0. Bu majburiyat va kapitalni noto'g'ri ko'rsatadi. Yechim: ta'minotchi qarzdorligi moduli; ulanmaguncha "ma'lumot yo'q".
4. **Operatsiyani bekor qilish diskni qaytarmaydi.** `server/db/database.ts:203`: transaction ichidagi insert/update darhol persist qiladi, catch esa faqat xotirani tiklaydi. Sun'iy persist kuzatuvida rollbackdan so'ng xotirada yozuv yo'q, oxirgi saqlangan nusxada bor. Qayta ochilganda bekor qilingan amal qaytishi mumkin. Yechim: tranzaksiya yakunigacha yozmaslik yoki haqiqiy tranzaksiyali baza.
5. **Buzilgan baza ustidan bo'sh baza yoziladi.** `database.ts:70`: JSON o'qish/parslash xatosida bo'sh holat saqlanadi. Yechim: asl faylni saqlab qolish, xatoda to'xtash, tekshirilgan zaxiradan tiklash.
6. **Administratorga avtomatik kirish.** `src/App.tsx:88`: sessiya bo'lmasa koddagi standart hisob bilan administratorga kiradi. Brauzerda tasdiqlandi. Login oynasida ham standart hisoblar bor. `auth.service.ts:7` da zaxira JWT siri kodga yozilgan. Yechim: demo rejimini alohida ajratish, majburiy kirish, noyob server siri.
7. **Vakolatlar bir xil tekshirilmaydi.** `product.routes.ts:43` va mahsulot tahririda faqat requireAuth mavjud; shu kompaniyadagi istalgan kirgan hisob narx/qoldiqni o'zgartirishi mumkin. Forecast sinxronlash, AI amallari va balansda ham maxsus ruxsat tekshiruvi yo'q. Oylik kabineti (`salary.routes.ts:316`) so'ralgan xodim aynan kirgan xodim ekanini marshrutda tekshirmaydi. Yechim: amal bo'yicha vakolat va o'z ma'lumotiga kirish tekshiruvi; kam huquqli hisob bilan salbiy testlar.

## Noto'g'ri natija va yolg'on muvaffaqiyat

8. **SMS yuborilmasdan SENT yoziladi.** `forecast.service.ts:271` faqat mahalliy notification yozuvi yaratadi va muvaffaqiyat qaytaradi; `notification.service.ts:87` ham yuborishni simulyatsiya qiladi. Haqiqiy SMS yuborish bajarilmadi. Yechim: provayder javobi bo'lmaguncha SENT emas, navbat/ulanmagan holati.
9. **1C adapteri haqiqiy ulanishsiz muvaffaqiyat qaytaradi.** `distribution.adapter.ts:18`: testConnection faqat kutadi va ok:true qaytaradi; importlar bo'sh, eksport faqat matn qaytaradi. Yechim: haqiqiy adapter yoki aniq demo/ulanmagan holati.
10. **AI bo'lmaganda ham haqiqiy Gemini deb ko'rsatiladi.** `ai.service.ts:349` is_live_ai:false qaytaradi, lekin `DashboardView.tsx:600` doim Gemini va Haqiqiy Real Vaqt yozadi. Nol mahsulotda "zudlik bilan yangi partiya buyurtma qiling", nol kassada "pul yetarli" degan tayyor xulosalar brauzerda ko'rindi. Yechim: haqiqiy AI va mahalliy qoidalarni ajratish; yetarli ma'lumot bo'lmasa xulosa bermaslik.
11. **Prognoz nol savdoni sun'iy savdoga aylantiradi.** `forecast.service.ts:89,181`: 0 kunlik savdo 15/20 ga, 0 kamomad kuni 3 ga almashtiriladi. Sinovda 0 savdo va 0 kamomad kuni uchun 60 yo'qotilgan birlik, 3 000 so'm foyda yo'qotilishi chiqdi. Yechim: 0 va noma'lumni ajratish, tarixiy sotuvdan hisoblash, taxminni yorliqlash.
12. **Bosh sahifada yuklanish vaqtida soxta sonlar bor.** `DashboardView.tsx:123`: 14.5 kun, 3 tugagan mahsulot va boshqa tayyor sonlar. Brauzerda avval shu qiymatlar, so'ng 0 ko'rindi. Yuklash xatosida ham shu qiymatlar qolishi mumkin. Yechim: yuklanmoqda, ma'lumot yo'q va xato holatlari.
13. **SalesDoc kodi bir-biriga mos emas.** importEmployees ikki marta e'lon qilingan (`salesdoc.adapter.ts:499,634`), keyingisi oldingisini almashtiradi. `provider.ts:437` mavjud bo'lmagan calculateHistoricalSalesVelocity funksiyasini chaqiradi va xatoni yashiradi. Shu sabab tarixiy tezlik yangilanmaydi. Yechim: yagona import yo'li va haqiqiy hisoblash funksiyasi.
14. **Mahsulot qiymatlari yetarlicha tekshirilmaydi.** `product.routes.ts:44` nom/SKU mavjudligini tekshiradi, lekin narx va qoldiq uchun Number(...) || 0 ishlatadi: noto'g'ri matn nolga aylanadi, manfiy qiymat o'tadi. Yechim: qat'iy schema, chekli sonlar va biznesga mos chegaralar.
15. **Bir nechta yopiq kassalar jamlanmaydi.** `analytics.service.ts:343` ochiq kassa yo'q bo'lsa barcha kassalardan faqat bitta eng so'nggi yopiq kunni oladi. Yechim: har bir kassaning oxirgi tegishli qoldig'ini jamlash.

## Sinovlar va chegaralar

- Dastur mahalliy manzilda ochildi; administratorga avtomatik kirish va dashboard xulosalari kuzatildi.
- TypeScript tekshiruvi 23 xato berdi: `review-types.log`.
- Brauzer uchun build o'tdi. Server build o'tdi, takroriy importEmployees ogohlantirishi bor: `review-server-build.log`.
- Integratsiya testlarining 4 tasi o'tdi; bu haqiqiy SalesDoc ulanishini tasdiqlamaydi.
- Qolgan 4 test fayli baza tayyorlash bosqichida Windows EPERM rename xatosi bilan to'xtadi. Ularning biznes tekshiruvlari muvaffaqiyatli o'tgan deb bo'lmaydi. Muhit/fayl almashtirish sababini alohida aniqlash kerak. Jurnallar `review-tests` ichida.
- Bank formulasi, tarixiy sana, nol savdo prognozi va rollback uchun alohida sun'iy sinov: `review-probes.ts`, natija `review-probes.log`. Rollback sinovida persist kuzatuvchi bilan almashtirilgan; haqiqiy biznes bazasiga yozilmadi.
- Haqiqiy buyurtma, pul o'tkazish, SMS jo'natish va tashqi sinxronlash bajarilmadi. Mobil ko'rinish va barcha shakllarning to'liq end-to-end sinovi hali o'tkazilmagan.
- Paketlar pnpm bilan o'rnatildi; arxivdagi bun.lock aynan qayta ijro qilinmadi. O'rnatilgan versiyalar pnpm-lock.yaml da.

## Tuzatish tartibi

1. Baza saqlash/tranzaksiya, administratorga kirish va vakolatlar.
2. Bank, ta'minotchi qarzi, tarixiy balans va kassalar jamlanishi.
3. Soxta AI/SMS/integratsiya holatlari va sun'iy prognozlar.
4. SalesDoc maydonlari, takroriy importlar, narx/qoldiq tekshiruvlari.
5. Xatosiz kod tekshiruvi, barcha testlar va keyin interfeys soddalashtirish.

Manba dasturining biznes kodi bu tahlilda tuzatilmagan; faqat ishga tushirish, sinov va tahlil fayllari qo'shildi.
