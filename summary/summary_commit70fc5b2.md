# สรุป commit `70fc5b2` — Add specialDiversity: count a special line once, upgrades included

- **Branch:** `main` (ต่อจาก `d1550dc`)
- **ประเภท:** weight บอทใหม่

## ที่มา

ผู้ใช้ดู `air-w3-pace4-slate` seed 13 แล้วเห็น Helltaker 3–4 ตัว บอททำ Jade ซ้ำ 4 ครั้ง (ด่าน 13, 21, 32, 43) แล้วอัปเป็น Helltaker ทุกตัว เพราะบอทเช็ก "สูตรนี้ทำแล้ว" จากชื่อ Jade เท่านั้น พอ Jade ถูกอัปเป็น Helltaker บอทจึงคิดว่ายังไม่มี Jade

## `specialDiversity` (0–1, ค่าเริ่ม 0)

- นับ special ทั้งสายเป็นสายเดียว (ตาราง `SPECIAL_LINE` ไล่จากผลของทุกสูตรตามการอัป) เช่น Jade / China Jade / Lucky China Jade / Helltaker
- ตอนเลือกทำ special: คะแนน (รวม specialBonus) × (1 − ค่านี้ × จำนวน tower สายเดียวกันที่มีแล้ว) ต่ำสุด 0.1
- ตอนวางแผนสูตร (recipeProgress): โบนัสคูณด้วยตัวเดียวกัน บอทจึงไปเก็บวัตถุดิบสูตรอื่นแทน

## ผลทดสอบ (120 seed, ฐาน `air-w3-pace4-slate` ที่ด่าน 32.12, slate เปิด)

| ชุด | ด่านเฉลี่ย | Helltaker ตอนจบ (รวม) | special ขั้นสูง | quality ตอนจบ |
|---|---|---|---|---|
| `fix-sd5` (specialDiversity 0.5) | **32.33** (+0.22, z 1.4) | 12 | 6 | 5.0 |
| `fix-sd9-core5-q8` (0.9 + coreRefill 5 + qualityMaxLevel 8) | 31.54 (−0.79 vs fix-sd5, z −1.8) | **4 (ไม่มีเกมไหนซ้ำ)** | **154 ครบ 8 แบบ** | 7.6 |
| `fix-q8` (qualityMaxLevel 8 อย่างเดียว) | 30.68 (−1.44, z −3.3) | – | 116 | 7.5 |
| `fix-all-pace4-max6` (quality ถึง 6 + sd 0.5 + coreRefill 5) | 31.97 (−0.15) | – | 22 | 6.0 |

**ข้อสรุป:** specialDiversity ไม่ทำให้เสียด่าน และแก้ Helltaker ซ้ำได้ ส่วน quality 7–8 ยังทำให้ด่านเฉลี่ยลด เพราะทองที่ใช้อัป quality ไปแย่งทองจากการอัป tower

## อื่น ๆ

- พบว่าสคริปต์ replay ใน scratchpad ที่ใช้วิเคราะห์ก่อนหน้านี้ใช้ time step 1/30 แต่เกมใช้ 1/60 (`STEP`) แก้แล้ว ผลวิเคราะห์เกมก่อนหน้านี้หลังเวฟแรกจึงอาจไม่ตรงกับเกมจริง (ไม่กระทบโค้ดใน repo)

## เทสต์

- `ai-test`: เพิ่ม test ว่า Jade ที่มีสายเดียวกันยืนอยู่ 1 ตัวได้ ×0.5 ส่วน Silver ×1
- `bot-golden` ตรงทุก move 11 เกม; `tsc`, `features-test`, `determinism-test`, `versus-test`, `render-smoke`, `ai-test`, `vite build` ผ่าน
