# สรุป commit `62a0646` — Add swapToCore and late-game weights (lateLevel, plainOutside, lateRecipeBoost)

- **Branch:** `main` (ต่อจาก `961e8c2`)
- **ประเภท:** weight บอทใหม่ + action ใหม่ของบอท

## `swapToCore` (0/1, ค่าเริ่มต้น 0)

- บอทใช้ความสามารถ **Swap** ได้แล้ว (action ใหม่ `swap`) ใช้กับแปลนที่มี core เท่านั้น
- tower ที่ Swap ได้ (Black Opal, Gold, Fire Star, Lucky China Jade, ...) ที่ยืนอยู่นอกสี่เหลี่ยม core จะสลับที่กับหินหรือเจมธรรมดาในสี่เหลี่ยม core เมื่อยิงทางได้มากขึ้นอย่างน้อย 3 ช่อง (นับแบบเดียวกับตอนวาง special) ราคา 200 ทอง
- ค้นหาครั้งเดียวต่อการเปลี่ยนกระดาน (`swapChecked` ผูกกับ `game.version`) ไม่ทำให้บอทช้าลงทุก step

## ช่วงท้ายเกม: `lateLevel`, `plainOutside`, `lateRecipeBoost` (ค่าเริ่มต้น 0 ทั้งหมด)

- `lateLevel`: ตั้งแต่ด่านนี้ อีกสองตัวจะเริ่มทำงาน (0 = ไม่ใช้)
- `plainOutside` (0–1): การ keep / combine / downgrade เจมธรรมดาที่ไม่มีสูตรไหนต้องการ ลงในสี่เหลี่ยม core มีค่า × (1 − ค่านี้) ช่องกลางจึงเหลือเป็นหินไว้ให้ `coreRefill` สุ่มหา special
- `lateRecipeBoost` (0–5): โบนัสวางแผนสูตร × (1 + ค่านี้) ให้เก็บวัตถุดิบสูตรที่ยังไม่ได้ทำ แทนเจมธรรมดาที่ power สูงแต่ไปต่อไม่ได้

ค่าเริ่มต้นทั้งสี่ตัวเป็น 0 ชุดค่าน้ำหนักเดิมจึงเล่นเหมือนเดิม

## อื่น ๆ

- `describeAction` ใน `autoplay.ts` แสดงข้อความของ action `swap` ในโหมดดู AI เล่นบนเบราว์เซอร์

## เทสต์

- `ai-test`: เพิ่ม test 2 ข้อบน 6 seed ของแปลน `orbit-s-v4-c10-core`
  - `swapToCore` เกิด swap จริง และทุกครั้งย้ายจากนอก core เข้าใน core จ่ายทองแล้ว และ tower ย้ายไปจริง
  - `plainOutside 1` (ตั้งแต่ด่าน 25) เก็บเจมธรรมดาไว้ใน core น้อยกว่าตอนไม่ใช้
- `tsc`, `ai-test`, `determinism-test`, `features-test` ผ่าน
- ยังไม่ได้รัน `bot-golden` และยังไม่ได้รัน batch วัดผลด่านเฉลี่ยของ weight ใหม่
