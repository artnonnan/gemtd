# สรุป commit `0c93154` — Record bot games and analyze them

- **Branch:** `ai-sim` (ต่อจาก `092b05a`)
- **ขั้นในแผน AI:** ขั้นที่ 3 จาก 7 (recorder + analyzer) และวางพื้นสำหรับให้ LLM ช่วยจูน

## สรุปสั้น

1. ทุกเกมของบอททิ้ง **`GameRecord`** ขนาดเล็ก (~900 bytes ต่อเกม) ไว้ให้วิเคราะห์
2. **`analyze.ts`** สรุปสถิติจากหลายเกม และเปรียบเทียบค่าน้ำหนักสองชุด**แบบจับคู่รายต่อ seed พร้อม standard error** ความต่างจะนับว่าจริงก็ต่อเมื่อเกินระดับโชค (|z| ≥ 2)
3. **`Weights`** มี `source`, ข้อเสนอจาก LLM (สมมติฐาน + ผลที่คาดว่าจะเกิด ซึ่งตรวจได้อัตโนมัติ) และ **`WEIGHT_SPECS`** ที่รวมขอบเขต, การเป็นจำนวนเต็ม และคำอธิบายของทุกค่าไว้ที่เดียว
4. Tower นับ damage ที่ทำได้ ผลเกมไม่เปลี่ยน (ตรวจกับ golden ทีละ action แล้ว)

## `GameRecord` เก็บอะไร

| field | ความหมาย |
|---|---|
| `seed`, `weightsId`, `result`, `level`, `lives`, `gold`, `kills`, `qualityLevel`, `routeLen`, `moves` | ผลรวมของเกม |
| `score` | `level + lives × 0.1 + (ชนะ ? 10 : 0)` |
| `livesLost[]` | lives ที่เสียในแต่ละเวฟ (index = ด่าน − 1) |
| `goldAtWave[]` | ทองตอนเริ่มแต่ละเวฟ |
| `towers{id: {dmg, waves}}` | damage และจำนวน "tower × เวฟ" ของแต่ละชนิด tower |
| `picks[]` | การเลือกแต่ละรอบ เช่น `"5:keep:h00B"`, `"8:combine2:h03S"` |
| `upgrades[]` | การอัป tower เช่น `"12:h001>h002"` |
| `final[]` | tower บนกระดานตอนจบ |

**ไม่เก็บ log ของ action**: เกมถูกกำหนดด้วย seed + ค่าน้ำหนักทั้งหมดแล้ว อยากดูเกมไหนก็ให้บอทเล่นซ้ำได้ ถ้าเก็บ log ด้วย การรันข้ามคืนจะกินพื้นที่หลายร้อย MB

**การนับ lives ที่เสีย**: ใช้ค่า lives ก่อนเลือก keep/combine (ซึ่งเป็นจังหวะที่เวฟเริ่ม) ลบด้วย lives ตอนเวฟจบ

## สิ่งที่ `analyze.ts` ให้

**`summarize(records)`**: คะแนนเฉลี่ยและ SD, ด่านเฉลี่ย, อัตราชนะ, ตายที่ด่านไหนกี่เกม, ตายด้วยเวฟชนิดไหน (air / ground / boss), lives ที่เสียแยกตามชนิดเวฟและรายด่าน, ทองเฉลี่ยต่อเวฟ และสถิติ tower ทุกชนิด:
- `pickRate`: สัดส่วนเกมที่มี tower นี้ตอนจบ
- `damageShare`: สัดส่วน damage จากทั้งหมด
- `dmgPerWave`: damage ต่อ tower ต่อเวฟ
- `levelWith` / `levelWithout`: ด่านเฉลี่ยของเกมที่มีหรือไม่มี tower นี้ (เป็นแค่ความสัมพันธ์ ไม่ใช่เหตุและผล)
- special ที่ทำได้ และสูตรที่ไม่เคยถูกทำเลย

**`paired(base, cand, metric)`**: ค่าเฉลี่ยของ (ชุดใหม่ − ชุดเดิม) รายต่อ seed พร้อม standard error และ z เพราะทั้งสองชุดเล่น seed เดียวกัน การเทียบรายคู่จึงตัดโชคออกไปได้มาก

**`checkExpectation`**: ตรวจข้อเสนอของ LLM ว่า **ทายถูก / ทายผิด / ไม่มีผลชัดเจน** จาก metric ที่ระบุไว้ ไม่ได้ดูแค่คะแนนรวม

### Metric ที่ใช้ทายได้ (`METRICS`)

`score`, `level`, `lives`, `win`, `livesLost`, `livesLost.air`, `livesLost.ground`, `livesLost.boss` (ใส่ช่วงด่านได้) และ `damageShare`, `picked` (ระบุ tower)

### นิยามเวฟบอส

ข้อมูลเวฟไม่มี flag บอกว่าเป็นบอส จึงใช้ชื่อ **"Summon" / "Summon Air"** (ด่าน 7, 14, 21, 28, 35, 42, 49) เพราะมี HP สูงกว่าเวฟข้างเคียงหลายเท่า เช่น ด่าน 14 มี 4,567 HP ส่วนด่าน 13 กับ 15 มี 750 และ 1,050 ไม่นับ "Summon Egg" ในด่าน 1

## การเปลี่ยนแปลงใน `weights.ts`

- `source: 'baseline' | 'hill' | 'llm' | 'manual'`: ค่าน้ำหนักที่โหลดจากไฟล์โดยไม่ระบุ source จะถูกตั้งเป็น `manual`
- `proposal`: `{ id, hypothesis, expect: [{metric, levels?, tower?, direction}], expectText }`
- `WEIGHT_SPECS`: ขอบเขต, ค่าที่ต้องเป็นจำนวนเต็ม (`qualityReserve`, `qualityMaxLevel`, `upgradeReserve`, `buyLifeBelow`) และคำอธิบายภาษาไทยว่าแต่ละค่ามีผลกับเกมอย่างไร
- `clampWeight`, `withDefaults` (เติมค่าที่ขาด + clamp), `weightsKey` (ใช้กันลองชุดซ้ำ), `describeChanges` (เช่น "mazeGain 0→0.5")

## การเปลี่ยนแปลงในเกม (`game.ts`)

- `Tower.damage`: damage หลังหักเกราะ ไม่นับส่วนที่เกิน HP ที่เหลือของครีป (overkill)
- ตอน combine, ทำ special และรวม slate ให้รวม damage ของ tower ที่ถูกใช้ไป (เหมือนที่รวม kills อยู่แล้ว)
- **ไม่เปลี่ยนผลเกม**: `bot-golden --check` ตรงกับ g1 ทุก action

## เทสต์ใหม่: `npm run ai-test`

- จำแนกชนิดเวฟถูก (ด่าน 4 = air, Summon = boss)
- lives ที่เสียรายเวฟรวมกันได้เท่ากับ lives ที่หายไป, มีหนึ่งรายการต่อด่าน และหนึ่ง pick ต่อด่าน
- บันทึก seed เดิมสองครั้งได้ record เหมือนกันทุก byte
- damage share รวมได้ ~1, เทียบชุดเดียวกันกับตัวเองได้ diff = 0 พอดี
- ตัวตรวจผลที่คาดไว้: ทายถูก / ทายผิด / ไม่มีผล ทำงานถูกกับข้อมูลสังเคราะห์
- clamp และ `withDefaults` ทำงานถูก

**ผล:** ผ่านทั้งหมด เทสต์เดิมทุกตัวและ `tsc` ผ่านด้วย

## สิ่งที่เห็นจากข้อมูลแล้ว

- เกม seed 1 ของ `w0` เสีย 32 lives ในด่าน 13 และอีก 18 ในด่าน 14 (บอส) **โดยไม่เคยอัป tower เลยสักครั้ง** การใช้ทองน่าจะเป็นจุดแรกที่ควรจูน
- 6 seed แรก smart ได้คะแนนแย่กว่า `w0` เฉลี่ย 2 คะแนน (z = −2.58) แต่ตัวอย่างยังน้อย ต้องรอดูผล 200 seed

## ขั้นต่อไป

ขั้นที่ 5: batch CLI ที่รันขนานหลาย core พร้อม seed หลัก 200 ตัวและ holdout แล้วต่อด้วยขั้นที่ 6: tuner + รายงานแต่ละรอบ + export สรุปให้ LLM / import ข้อเสนอ
