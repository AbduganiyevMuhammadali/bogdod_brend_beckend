# Inventarizatsiya qoldiqlarini qaytarish — yo'riqnoma

Sanoq tugatilmagan holda "Yakunlash" bosilgani uchun skanerlanmagan
tovarlarning qoldig'i 0 ga tushib qolgan. Bu yo'riqnoma ularni qaytaradi.

## Nega qaytarish mumkin

Hujjat ochilganda har bir tovarning **o'sha paytdagi qoldig'i**
`inventory_item.expected_qty` ustuniga yozilgan. Yakunlash bu ustunni
o'zgartirmaydi — faqat o'qiydi. Ya'ni eski qoldiqlar bazada turibdi.

---

## MUHIM: avval baza nusxasini oling

Bu **do'kondagi kompyuterda** bajariladi — bazadagi haqiqiy ma'lumot o'sha yerda.

**1-qadam. Serverni to'xtating** (POS dasturini yoping) — qaytarish paytida
sotuv bo'lmasligi kerak.

**2-qadam. Zaxira nusxa oling.** Bu eng muhim qadam:

```bash
cd <loyiha papkasi>/beckend
mysqldump -u root -p sellz > ~/Desktop/zaxira-QAYTARISHDAN-OLDIN.sql
```

> `sellz` o'rniga `.env` faylidagi `DB_DATABASE` qiymatini yozing.
> Fayl hajmi 0 bo'lmasligini tekshiring.

Agar biror narsa noto'g'ri ketsa, shu nusxadan tiklaysiz:
```bash
mysql -u root -p sellz < ~/Desktop/zaxira-QAYTARISHDAN-OLDIN.sql
```

---

## 3-qadam. Avval KO'RIB chiqing (hech narsa o'zgarmaydi)

```bash
cd <loyiha papkasi>/beckend
node tools/inventarizatsiya-qaytarish.js
```

Bu quyidagilarni ko'rsatadi:
- qaysi hujjat qaytariladi (raqami, sanasi)
- nechta tovarning qoldig'i o'zgaradi
- namuna jadval: `hozir` → `qaytariladi`
- yakunlashdan **keyin sotilgan** tovar bo'lsa — ogohlantirish

Jadvaldagi `qaytariladi` ustuni haqiqatga to'g'ri kelishini tekshiring.

---

## 4-qadam. Qaytarish

Ko'rgan natijangiz to'g'ri bo'lsa:

```bash
node tools/inventarizatsiya-qaytarish.js --apply --id=<hujjat_id>
```

`<hujjat_id>` — 3-qadamda ko'rsatilgan `id` raqami.

Skript nima qiladi:
1. `product.qty` → hujjat ochilgandagi qoldiqqa qaytariladi
2. Yakunlashdan **keyin sotilgan** tovar qoldiqdan ayiriladi (sotuvlar bekor qilinmaydi)
3. FIFO partiyalari (`purchase_item.stock_qty`) qoldiqqa moslanadi
4. Yakunlash ochgan "ortiqcha" kirim hujjatlari o'chiriladi
5. Hujjat `draft` holatiga qaytadi — sanoqni davom ettirish mumkin

Hammasi **bitta tranzaksiyada** bajariladi: xatolik chiqsa hech narsa
o'zgarmaydi.

---

## 5-qadam. Tekshiring

Dasturni oching va Mahsulotlar sahifasida qoldiqlarni ko'ring. Bir nechta
tovarni omordagi haqiqiy holat bilan solishtiring.

---

## Savol-javob

**Bir nechta hujjat noto'g'ri yakunlangan bo'lsa?**
Har biri uchun alohida `--id=` bilan ishga tushiring, eng oxirgisidan
boshlab orqaga qarab.

**Skriptni ikki marta ishga tushirsam bo'ladimi?**
Ha, xavfsiz. `expected_qty` o'zgarmaydi, shuning uchun natija bir xil
bo'ladi.

**Yakunlashdan keyin sotuv bo'lgan bo'lsa-chi?**
Skript ularni avtomatik hisobga oladi: qaytariladigan qoldiqdan sotilgan
miqdor ayiriladi. Sotuv hujjatlari o'chirilmaydi.

**Hujjat ochilgandan keyin kirim (postupleniya) bo'lgan bo'lsa?**
Skript uni hisobga olmaydi — qoldiq hujjat ochilgan paytdagi holatga
qaytadi. Bunday kirim bo'lgan bo'lsa, qaytargandan keyin o'sha kirim
miqdorini qo'lda qo'shing (yoki kirim hujjatini qayta tasdiqlang).

---

## Bundan keyin takrorlanmasligi uchun

Dasturga himoya qo'shildi: sanoq tugallanmagan holda "Yakunlash" bosilsa,
endi nechta tovar nolga tushishi aniq aytiladi va tasdiqlash uchun
qo'lda **TASDIQLAYMAN** deb yozish talab qilinadi.
