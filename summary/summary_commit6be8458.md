# สรุป commit `6be8458` — Add weights for late towers, core refill, armor auras and a quality pace

- **Branch:** `main` (ต่อจาก `47703e3`)
- **ประเภท:** weight บอทใหม่ + blueprint 2 แบบ + แก้บั๊ก slate

## 1. weight ใหม่ (ค่าเริ่ม 0 ทุกตัว บอทเดิมเล่นเหมือนเดิมทุกตา)

| weight | ทำอะไร | ที่มา |
|---|---|---|
| `tierValue` (0–5) | ค่าของ special = power ตอนนี้ + ค่านี้ × (power ของตัวที่อัปต่ออีก 2 ขั้น สูงสุด 5000) / 10 ใช้ทั้งตอนเลือกและวางแผนสูตร | ผู้ใช้อยากให้บอทมองเผื่อ Uranium 238, Black Opal, Paraiba ฯลฯ |
| `slatePairBonus` (0–5000) | slate ที่เป็นครึ่งหนึ่งของ slate พิเศษได้โบนัส (เต็มเมื่ออีกครึ่งมีแล้ว ครึ่งเดียวเมื่อเริ่มคู่) ใช้คู่ slateCombine | ให้ได้ Elder / Viper / Wraith / Ancient |
| `coreRefill` (0–5) | เมื่อสร้างแปลนเสร็จ ทุกด่านถอนหินในสี่เหลี่ยม core ของแปลนแล้ววางเจมทับทันที (ก้อนที่ยิงทางมากสุดก่อน) | ผู้ใช้อยากให้หลังแปลนเสร็จ focus ป้อมกลางแทนสร้างวงรอบนอก |
| `armorAuraValue` (0–5) | ออร่าลดเกราะ (Red Crystal ลดเกราะศัตรูบิน) มีค่า = ค่านี้ × เกราะ × 5% × power ของ tower ที่ยิงเป้านั้นในรัศมี; กับ specialSpot เลือกจุดที่ออร่าครอบเส้นทางบินมากสุด | ผู้ใช้แนะนำ Red Crystal วางกลางเพื่อรับบอสอากาศ |
| `qualityPace` (0–10) | เป้า quality = floor(ด่าน / ค่านี้) ถ้าต่ำกว่าเป้าอัปทันทีที่ทองพอ (ไม่กัน qualityReserve ไม่รอ chippedHold) | ผู้ใช้เห็นว่า qualityReserve ไม่ยืดหยุ่น บอทไม่อัป quality เลยจนด่าน 8 |

- `qualityRushLevel` ตอนนี้ยกเลิก chippedHold ด้วยเมื่อถึงด่านที่เร่ง

## 2. blueprint

- `orbit-s-v4-c10b`: v4-c10 ที่ลบ 16,2 และ 16,3 (ผู้ใช้ขอ) ทางตอนสร้างครบยาวเท่าเดิม 807.3 แต่เส้นทางเปลี่ยนไปใช้อีกเส้นที่ยาวเท่ากันใกล้ checkpoint 1
- `orbit-s-v4-c10-core`: v4-c10 ทุกช่องเหมือนเดิม เพิ่ม `core` = สี่เหลี่ยม 14,16–22,20 สำหรับ coreRefill
- `Blueprint` มีช่อง `core` (ไม่บังคับ) เพิ่ม

## 3. แก้บั๊ก

- เปิด slateTeleport แล้วบอทพังที่ seed 10: slate ใหม่เกิดบนเจมที่ตั้งบน slate เดิม ทำให้ 2 ตัวซ้อนจุดเดียว และ `applyAction` หยิบตัวที่ teleport ไปแล้ว ตอนนี้เลือกตัวที่ทำ action นั้นได้

## ผลทดสอบ (120 seed, `orbit-s-v4-c10`)

| ชุด | ด่านเฉลี่ย | ต่าง (z) | หมายเหตุ |
|---|---|---|---|
| `orbit-v4c10-a` | 28.53 | – | ก่อนใช้ planFirst |
| `orbit-v4c10-a` + planFirst | 29.37 | +0.84 (2.8) | สร้างแปลน v4-c10 ให้เสร็จก่อนคุ้มชัด |
| **`llm-orbit-v4-w16-pf`** | **29.98** | +1.42 (3.5) เทียบ w16 | best ตอนนี้ |
| w16-pf + tierValue 1 / 2 | 29.03 / 28.50 | −0.94 / −1.48 | quality ~2 ไม่มีเจม Perfect ทำสูตรขั้นสูง |
| w16-pf + เร่ง quality ด่าน 18 + tierValue 1 | 28.18 | −1.79 | ทำ special ขั้นสูงได้ 36 ตัว ครบ 8 แบบ แต่ทองไม่พออัป |
| w16-pf + slatePairBonus + slateCombine + teleport | 29.93 | −0.05 | ได้ slate พิเศษ 39 ตัว ครบ 4 แบบ ไม่เสียด่าน |
| w16-pf + coreRefill 2 / 5 | 30.00 / 29.94 | ±0.03 | แปลนเสร็จราวด่าน 29 แต่ 115/120 เกมตายด่าน 28 หรือ 32 จึงแทบไม่ได้ทำงาน |
| `llm-orbit-v4-air-w3` (armorAuraValue 3 + เร่ง quality ด่าน 16) | 29.93 | −0.04 | Red Crystal 58/120 เกม (เดิม 6); ตายด่าน 28 ลด 66 → 51 แต่ตายด่าน 20–21 / 32 มากขึ้น |
| w16-pf + qualityPace 2 / 3 / 4 / 6 | 21.09 / 25.11 / 28.16 / 29.33 | −8.88 / −4.87 / −1.82 / −0.64 | ยิ่งเร่ง quality ยิ่งแย่ (เสียเจม Chipped ทำ Silver) แม้ pace 3 จะได้ special ขั้นสูง 69 ตัว |
| air-w3 + qualityPace 4 | 30.16 | +0.23 (0.5) | ดีสุดในรอบนี้แต่ยังไม่มีนัยสำคัญ |

**ข้อสรุป:** บอทสร้าง special ขั้นสูงและ slate พิเศษได้แล้ว แต่ในช่วง 30 ด่านแรกสายเริ่มต้น (Silver Knight, Mighty Malachite, Fire Star) ที่อัปเต็มยังคุ้มกว่า คอขวดคือบอสอากาศด่าน 28 และ Black Dragon ด่าน 32

## เทสต์

- `ai-test` เพิ่ม: tierValue, slatePairBonus, coreRefill, armorAuraValue, qualityPace
- `bot-golden` ตรงทุก move 11 เกม และเกมของ weight ที่ tune แล้ว 20 เกมเหมือนเดิม
- `tsc`, `features-test`, `determinism-test`, `versus-test`, `render-smoke`, `vite build` ผ่าน; blueprint ใหม่ทั้งสอง validate ผ่าน

## ยังไม่ได้ทำ

- slatePairBonus ในเกมทดสอบสั้น 4 เกมยังไม่ได้ slate พิเศษ (ได้ใน batch 120 เกม)
- ตำแหน่ง Red Crystal ยังไม่กลางพอ: รัศมีออร่ากว้าง ~10 ช่อง จุดแถวกลางได้คะแนนพอ ๆ กัน
