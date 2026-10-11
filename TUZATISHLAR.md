# CRM va xodim kabinetlari — 2026-09-30

## Xodimlarga kirish
- Sozlamalar → "Xodimlarga kirish" bo'limida egasi har bir xodimga login (telefon raqami yoki lotincha nom) va rol beradi.
- Tizim vaqtinchalik parol yaratadi va uni bir marta ko'rsatadi. Xodim birinchi kirishda o'z parolini o'rnatmaguncha hech narsa qila olmaydi.
- Parolni tiklash, hisobni bloklash va rolni almashtirish mumkin. Hammasi audit jurnaliga yoziladi.
- 10 ta noto'g'ri urinishdan keyin login shu qurilmadan 15 daqiqaga bloklanadi.
- "Xodim" roli faqat o'z kabinetini, o'z mijozlarini va CRM'ni ko'radi. AGENT va KASSIR rollari kompaniya bo'limlarini ham ochadi, ularning huquqlari jadvalda sozlanadi.
- Menyu faqat ruxsat berilgan bo'limlarni ko'rsatadi. Bosh sahifa statistikasi ham endi ruxsat talab qiladi (`reports:view`).

## Mening kabinetim
Xodim faqat o'ziga tegishli ma'lumotlarni ko'radi:
- oylik (asosiy, KPI, ishbay, ushlanmalar);
- vazifalar (bajarildi deb belgilash mumkin);
- biriktirilgan mijozlar va ularning qarzi;
- o'zi kiritgan xarajatlar va kunlik limit.

## CRM
- **Vazifalar:** mas'ul, muddat, muhimlik. Mijoz yoki bitimga bog'lanadi. Kechikkanlari qizil bilan ajratiladi. Boshqa xodimga vazifani faqat rahbar beradi.
- **Aloqa jurnali:** qo'ng'iroq, tashrif, uchrashuv va natija yoziladi. "Keyingi qadam" sanasi berilsa, u avtomatik vazifaga aylanadi.
- **Sotuv voronkasi:** bosqichlari sozlanadi (nomi, ehtimoli, turi). Lid yoki bitim mavjud mijozga ham, yangi kontaktga ham ochiladi. Yutqazilgan bitim uchun sabab majburiy. Bosqichlar bo'yicha summa va ehtimol bilan tortilgan summa ko'rsatiladi.
- **Mijoz kartasi 360°:**
  - kontakt, agent va mas'ul xodim;
  - 90 kunlik va jami savdo, oxirgi buyurtma;
  - qarz va uning yoshi, qarz daftari;
  - buyurtmalar, aloqalar, vazifalar, bitimlar;
  - teglar.
- **Ko'rinish qoidasi:** rahbar hammasini ko'radi. Xodim faqat o'ziga tegishli yoki o'zining mijozlariga oid yozuvlarni ko'radi.

## Tuzatilgan xatolar
- **Takroriy mijozlar (996 ta).** Tarix yuklovchi `SD-CUST-` prefiksli eski kodni tanimay, mijozlarning nusxasini yaratgan edi. Migratsiya 008 ularni birlashtirdi: qarz saqlangan kartaga barcha buyurtmalar va bog'lanishlar o'tkazildi. Nusxalar karantinga ko'chirildi. Oldidan `finance_db.json.backup-008` nusxasi olindi.
- **Agentlar.** Buyurtmalar va mijozlar SalesDoc'dagi agentga bog'lanadi. Buning uchun tarix bir marta qayta yuklanadi.
- **Bosh sahifadagi foyda.** "Kunlik sof foyda" 75% taxmin bilan hisoblanardi. Endi u foyda hisoboti bilan bir xil: tannarx noma'lum bo'lsa, "Hisoblanmadi" deb chiqadi.

## Tarmoq
Server hozir faqat shu kompyuterda ochiladi (`127.0.0.1`). Xodimlar telefondan kirishi uchun serverni mahalliy tarmoqda ochish kerak, bu alohida sozlanadi.

# Tuzatishlar — 2026-09-30

Birinchi ishga tushirishda `006_data_integrity_repair` migratsiyasi ishlaydi. Undan oldin baza `.data/finance_db.json.backup-006` nomi bilan nusxalanadi. Hech narsa o'chirilmaydi.

## SalesDoc to'liq tarixi va prognoz
- Tarix oyma-oy yuklanadi, eng yangi oydan boshlab. Sotuvsiz 12 oy ketma-ket kelsa, tarix boshlangan joy topilgan hisoblanadi. Boshlanish sanasini sozlamada qo'lda ham berish mumkin.
- SalesDoc sahifani takrorlasa, oraliq ikkiga bo'linadi, kerak bo'lsa bir kungacha. Bitta kun ham o'qilmasa, yuklash to'xtaydi: bo'shliq bilan "to'liq" deb saqlanmaydi.
- Har oy alohida saqlanadi. Server to'xtasa, qolgan joyidan davom etadi. 45 kundan eski yakunlangan oylar qayta yuklanmaydi.
- Yuklash fonda ishlaydi. Integratsiyalar sahifasida progress ko'rinadi: oy, buyurtmalar soni, qamrov.
- Prognoz faqat tarix yuklangan kunlarga bo'linadi: yuklanmagan davr "sotuv 0" deb hisoblanmaydi. Har mahsulotda ishonchlilik ko'rsatiladi: sotuv kunlari soni va oxirgi sotuv sanasi.
- Narx va qoldiq endi mahsulotning noyob ID'si (`SD_id`) bo'yicha bog'lanadi. Oldin umumiy `code_1C` ("Команда А") sabab bir mahsulotga boshqasining narxi yoki qoldig'i yozilishi mumkin edi.
- Server ishlab turganda "har N daqiqada/soatda" sinxronlash sozlamasi haqiqatan bajariladi.
- Tekshiruv: haqiqiy SalesDoc hisobida, bazaning nusxasida, 3 daqiqada 49 884 ta buyurtma yuklandi (2025-08-03 dan bugungacha).

## Pul va hisobotlar
- Foyda faqat yetkazilgan savdodan hisoblanadi. Yetkazilmagan buyurtmalar alohida ko'rsatiladi.
- Tannarx faqat mahsulotning haqiqiy kirim narxidan olinadi. 76%/78% taxminlar olib tashlandi.
- Tannarxi noma'lum savdo bo'lsa, sof foyda "Hisoblanmadi" deb chiqadi va qamrov foizi ko'rsatiladi.
- 1 so'm kabi to'ldiruvchi kirim narxi noma'lum hisoblanadi. Hozir SalesDoc'dagi "Келиш Нарх" ro'yxatida narxlar 1 so'm, shuning uchun foyda hisoblanmaydi. Kirim narxlari kiritilgach, hamma saqlangan buyurtmalar qayta hisoblanadi.
- Qarz yoshi: to'lov eng eski qarzni yopadi (FIFO). Guruhlar yig'indisi qarzga teng.
- Import qilingan, sanasi noma'lum qarz alohida "Sanasi noma'lum" ustunida turadi. Unga "14 kun kechikkan" degan soxta kun berilmaydi.
- Oylik ish haqi tanlangan davrga kunlar ulushiga qarab olinadi.
- Dollar kursi Markaziy bankdan (cbu.uz) sana bo'yicha olinadi. Olinmasa, dollar ko'rsatilmaydi.
- Sanalar Toshkent vaqti bo'yicha hisoblanadi. UTC sabab 00:00–05:00 oralig'ida "kecha" chiqish xatosi tuzatildi.

## Kassa va xavfsizlik
- Kassir oldingi kun qoldig'idan farqli boshlang'ich qoldiq kirita olmaydi. Buni faqat ADMIN yoki `cash:correct` huquqi bor foydalanuvchi qiladi.
- Yopilgan kassani faqat direktor yoki bosh buxgalter qayta ochadi, sabab ko'rsatib. Sabab audit jurnaliga yoziladi. Brauzerdagi 1234/7777 PIN olib tashlandi.
- Kassa kuni, tranzaksiya va tuzatish so'rovlarida kompaniya tekshiriladi.
- Rollar va huquqlar: ruxsat va kompaniya tekshiriladi. O'zida yo'q huquqni boshqaga berib bo'lmaydi.
- SalesDoc paroli va tokeni brauzerga qaytarilmaydi. Namunadagi JWT kaliti bilan server ishga tushmaydi.
- Kassa uchun soxta namunaviy buyurtmalar (4,5 mln, 7,2 mln...) yaratilmaydi.
- SalesDoc'ga yuborilgan to'lov kassada 0 ga o'zgartirilsa, bu xato sifatida ko'rsatiladi.
- SalesDoc'da bekor qilingan buyurtma kassa kunidan chiqariladi. To'lovi bo'lsa, tekshirish uchun belgilanadi.
- Boshqa dastur shu SalesDoc hisobiga kirib tokenni bekor qilsa, o'qish so'rovlari bir marta qayta kiradi.
- `.data/` papkasi Git'ga qo'shilmaydi.

## Boshqa integratsiyalar
- SmartUp, Linko va 1C adapterlari hali yozilmagan. Endi ular "ulandi" demaydi.
- Shaxsiy server adapteri haqiqiy HTTP so'rov bilan tekshiriladi.
- Umumiy sinxronlash yo'li tuzatildi:
  - To'lov bir marta yoziladi.
  - Mijoz topilmasa yozuv o'tkazib yuboriladi va xato ro'yxatiga tushadi (oldin birinchi mijozga yozilardi).
  - Agent to'lovlari kassaga naqd bo'lib tushmaydi.
  - Kassa kuni 0 qoldiq bilan avtomatik ochilmaydi.

## Migratsiya 006 bajaradigan ishlar
- 2097-yil, "42-oy" kabi sinov qoldiqlari va mavjud bo'lmagan kunga bog'langan yozuvlar `_quarantine` ga ko'chiriladi.
- `+998 90 000 00 00` telefonlari tozalanadi.
- 78% va 1 so'm kabi soxta kirim narxlari 0 (noma'lum) qilinadi.
- Tarixsiz import qilingan qarzlar "boshlang'ich qoldiq, sanasi noma'lum" deb qarz daftariga yoziladi.
- 1C "ulanmagan" holatiga o'tkaziladi.

## Hali qolgan ishlar
- Tannarx mahsulotning joriy kirim narxidan olinadi. SalesDoc o'tgan kunlar kirim narxini bermaydi.
- Tarixiy ombor qoldig'i (`getStockForDate`) SalesDoc cheklovi sabab olinmaydi: 5 daqiqada 1 so'rov yoki faqat tunda ishlaydi. Shuning uchun "tovar tugab qolgan kunlar" prognozdan chiqarilmaydi.
- Bank, ta'minotchi qarzi va SMS/Telegram yetkazish hali yo'q.

## Tekshiruv
- 8 ta test fayli o'tdi. `business_rules.test.ts` yangi qo'shildi.
- TypeScript tekshiruvi xatosiz.
- Migratsiya va to'liq tarix haqiqiy bazaning nusxasida sinaldi (`scripts/migrate-copy-check.ts`, `scripts/history-copy-check.ts`).

# Tuzatilgan versiya — 2026-09-27

## Ishga tushirish

`Moliya-ochish.cmd` faylini oching. Manzil: http://127.0.0.1:3100.
Birinchi kirishda egasi emailingiz va kamida 12 belgili yangi parol yarating. Standart sinov hisoblari faolsizlantiriladi, biznes yozuvlari saqlanadi. Parolni chatga yoki dastur kodiga kiritmang. Egasi sozlanganidan keyin qayta sozlash yopiladi.

## Tuzatilgan

- Administratorga avtomatik kirish va tayyor parolli rol almashtirish olib tashlandi.
- Egasi hisobini bir martalik mahalliy sozlash qo'shildi; bloklangan hisob tokeni rad etiladi. Koddagi doimiy JWT siri olib tashlandi. JWT_SECRET berilmasa server qayta ochilganda qayta kirish talab qilinadi.
- Tranzaksiya muvaffaqiyatli tugamaguncha baza diskka yozilmaydi; ichma-ich rollback va yozish xatosida xotirani qaytarish tekshirildi.
- Buzilgan bazani bo'sh baza bilan almashtirish to'xtatildi. Yozishdan oldingi `.previous` zaxira va Windows fayl almashinuvi uchun cheklangan qayta urinish bor.
- SMS va 1C ulangan bo'lmasa muvaffaqiyat qaytarilmaydi. Tashqi xabarnomalar yetkazilgan deb belgilanmaydi.
- Nol savdo va nol kamomad kuni sun'iy yo'qotilgan foydaga aylantirilmaydi. Yetkazilgan buyurtmalar asosida 30 kunlik sotuv tezligi hisoblanadi.
- SalesDoc'dagi takroriy funksiya va noto'g'ri integratsiya maydonlari tuzatildi.
- Mahsulot, hisobot, AI va sinxronlash marshrutlariga vakolat tekshiruvlari qo'shildi. Mahsulot narxi/qoldig'i manfiy yoki noto'g'ri son bo'lishi rad etiladi.
- AI bilan yozishish tasodifiy kalit so'z sabab yozish amallarini bajarmaydi. AI ishlamasa mahalliy qoidalar ekani ko'rsatiladi.
- Bank qoldig'ining 65% formulasi olib tashlandi. Noma'lum qoldiq va yakuniy balans o'rniga ma'lumot yetishmasligi ko'rsatiladi. Barcha kassalar qoldig'i jamlanadi.
- Tarixiy aktiv/majburiyat reestri bo'lmaganda eski sana uchun yolg'on balans berilmaydi.
- Testlar har biri alohida bazada ishlaydi; asosiy biznes bazasiga tegmaydi.

## Tekshiruv

56/56 test o'tdi: autentifikatsiya 4, kassa 21, migratsiya 3, xarajat 16, adapter 4, regressiya 8. TypeScript tekshiruvi xatosiz. Frontend va server yig'ildi. Test jurnallari `.test-runs/run-zGq1aT` ichida.
Brauzerda birinchi sozlash oynasi ochilishi tekshirildi. Egasi hisobi foydalanuvchi tomonidan hali kiritilishi kerak. Haqiqiy xizmatlar bilan to'liq sinov bajarilmagan.

## Ochiq qolgan ishlar

Bu 100% yakunlangan mahsulot emas. Quyidagilar alohida ishlab chiqish/ulanish talab qiladi:

- Bank hisobvaraqlari va kirim/chiqim reestri, ta'minotchilar va kreditorlik reestri.
- Sana bo'yicha ombor harakati, boshlang'ich qoldiqlar va to'liq tarixiy balans.
- SMS/Telegram yetkazish provayderlari, qayta urinish va yetkazish holati.
- Haqiqiy 1C adapteri va SalesDoc bilan barcha asosiy amallarni amaliy tekshirish.
- Gemini AI uchun foydalanuvchi kaliti va yuboriladigan biznes ma'lumotiga oid sozlama. Ushbu dastur Jarvis OpenAI kalitidan foydalanmaydi.
- Bir nechta server/kompyuter bir bazaga yozadigan rejim uchun tranzaksiyali SQL baza; hozir bitta mahalliy jarayon uchun JSON saqlash.
- Oylik kabinetining xodimga xos cheklangan ko'rinishi (hozir salary:view huquqi talab etiladi), barcha shakllar va mobil ko'rinishning yakuniy tekshiruvi.

Shu cheklovlar sabab dasturga hozircha to'liq bank/buxgalteriya balansi sifatida tayanmang. Sinovlardan o'tish tashqi integratsiyalar va barcha biznes holatlarining tasdig'i emas.
