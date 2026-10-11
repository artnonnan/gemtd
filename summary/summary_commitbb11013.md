# สรุป commit `bb11013` — Add orbit maze plans, tune-by-LLM loop, new bot weights and a replay leaderboard

- **Branch:** `main` (ต่อจาก `c55a666`)
- **ประเภท:** แผนเขาวงกตใหม่ + โหมด tune by LLM + weight บอทใหม่ + UI ดูบอทเล่น

## 1. แผนเขาวงกต (blueprint) ตระกูล orbit

| id | ช่อง | ที่มา |
|---|---|---|
| `orbit-s` | 168 | ลอกจากรูป `w3x/FZnyvmz.png` ที่ผู้ใช้ออกแบบ: วงแหวน 2 ชั้นรอบป้อมกลางเป็นทางเดียวระหว่างฝั่ง NW กับ NE |
| `orbit-s-v2` | 168 | ช่องเดียวกัน ลำดับใหม่: ปิดทางอ้อมรอบนอกก่อน และวางเจมกลางด่านละ 1–2 เม็ด |
| `orbit-s-v3` | 160 | v2 ที่เปิดป้อมกลางเป็นโค้ง U บนและล่าง ทุกช่วงทางมุดผ่านป้อมกลาง (แก้แค่ตรงกลาง) |
| `orbit-s-v4` | 144 | v3 ที่ตัดหินไม่จำเป็น 16 ก้อน ทางตอนสร้างครบเหมือนเดิมทุกก้าว และเรียงลำดับใหม่ |
| `orbit-s-v4-c10` / `-c20` | 144 | v4 ที่ดัน creep วนผ่านป้อมกลางเร็วขึ้น (น้ำหนักก้าวใกล้กลาง 10 / 20) |

- **หินที่ตัดใน v4:** รอบ checkpoint 2 (34,19 · 34,20 ตามที่ผู้ใช้ชี้ และ 30,16 · 34,16 · 34,18), รอบ checkpoint 5 (16,30–16,33), กำแพง W (6,18 · 12,18) และ 20,6 · 18,14 · 18,22; ด้านบนแทน 17,2 · 18,2 · 20,2 ด้วย 16,3 ช่องเดียว
- **ผล (weight เดียวกัน):** v4-c10 ได้ด่านเฉลี่ย 28.25 เทียบกับ v3 ที่ 26.07 (+2.17, z 3.0 บน 40 seed) และ 28.53 บน 120 seed เป็นผลดีที่สุดจนถึงตอนนี้ เพราะไฟยิงทางที่ด่าน 15 เพิ่มเกือบ 2 เท่า และเสีย lives ด่าน 1–14 ลดจาก 14.6 เหลือ 3.5
- SVG ของแต่ละแผนอยู่ที่ `w3x/orbit-v3-both.svg`, `w3x/orbit-v4*.svg` (นอก repo)

## 2. โหมด tune by LLM

- `npm run tune-llm -- --run=<ชื่อ> [--start=<weight>] [--import=<คำตอบ.json>]`
- แต่ละรอบ: เล่นข้อเสนอของ LLM บน 10 seed → ชุดที่ดีกว่า best (สูงสุด 2 ชุด) เล่นซ้ำบน 40 seed → รับเป็น best เมื่อ z ≥ 2 → เขียนคำขอรอบถัดไปไว้ที่ `sim-runs/tune-llm-<ชื่อ>/llm/`
- Claude Code ในแชทเป็นคนตอบคำขอ (LLM เป็นที่ปรึกษาเท่านั้น)
- ย้ายฟังก์ชัน rules hash ไป `scripts/ai/rules-hash.ts` ให้ CLI กับ dev server ใช้ตัวเดียวกัน (ค่า hash ไม่เปลี่ยน)

## 3. weight บอทใหม่ (ค่าเริ่ม 0 ทุกตัว บอทเดิมเล่นเหมือนเดิมทุกตา)

| กลุ่ม | weight | ทำอะไร |
|---|---|---|
| slate | `slateBonus`, `airSlateBonus`, `slateTeleport`, `slateCombine` | สร้าง / teleport / รวม slate |
| วางแผน | `recipeProgress`, `downgradeForRecipe` | keep เจมที่ทำให้สูตร special ใกล้ครบ, keep แบบลด quality |
| ทอง | `upgradeFocus`, `bossLifeTarget`, `qualityRushLevel`, `qualityFirst`, `chippedHold` | เลือก tower ที่อัปคุ้ม, ซื้อ life ก่อนบอส, ลำดับอัป quality, รอเจม Chipped ก่อนอัป quality |
| ป้อมกลาง | `specialSpot`, `keepFuture` | ทำ special ที่วัตถุดิบตัวที่ยิงทางมากสุด (Star Ruby นับระยะเผา), ตัดสินตำแหน่ง keep จากทางตอนแปลนเสร็จ |
| สร้างจากกลาง | `centreFirst`, `centreGoodPower`, `centreRockShare`, `rockClear`, `rockClearFromLevel`, `planFirst` | วางเจมกลางก่อนจนได้เจมดี, ถอนหินกลางแล้ววางทับ, วางตามลำดับแปลนเคร่ง |
| การเลือก | `typeDiversity`, `auraValue` | หักคะแนนชนิดซ้ำ, ให้ค่าออร่าเร่งความเร็วของ Opal |

action ใหม่ของบอท: `removeRock`

**ผลที่วัดได้ (สรุป)**
- ชุดดีที่สุด: `orbit-v4c10-a` = keepFuture 0.75 + specialSpot บน orbit-s-v4-c10
- แย่ลงชัด: `qualityFirst` (−8.4: ไม่มีทองอัป tower และไม่มีเจม Chipped ทำ Silver), `planFirst` (−2.8), `rockClear` จากด่านแรก (−1.7)
- ไม่ต่างอย่างมีนัยสำคัญ: `typeDiversity`, `auraValue`, `chippedHold` (+0.03 บน 120 seed), `centreFirst`

## 4. UI ดูบอทเล่น (Settings → AI auto-play)

- ช่อง weight เป็น dropdown: built-in, best ของแต่ละรอบ tune, ทุกชุดที่บันทึกไว้ (ใหม่สุดก่อน)
- ตาราง **Leaderboard**: เรียงตามด่านเฉลี่ย มีคอลัมน์แผนที่และจำนวนเกม กรองตามแผนที่และจำนวนเกมขั้นต่ำได้ ทุกแถวมีปุ่ม ▶ best (เกมดีสุด) และ ▶ typical (เกม median) กดแล้วเล่นทันที
- ★ = best ของรอบ tune, ⚠ = ผลที่เล่นก่อนแก้โค้ดบอทครั้งล่าสุด
- ข้อมูลมาจาก endpoint `/__weights` ใน `vite.config.ts` (เฉพาะ `npm run dev`); เว็บที่ deploy มีแค่ w0 / smart เหมือนเดิม

## เทสต์

- `ai-test`: เพิ่ม test ของ rockClear, rockClearFromLevel, planFirst, centreFirst, keepFuture (เคส Silver ด่าน 6 seed 8 ย้ายเข้ากลาง), qualityFirst, typeDiversity, auraValue, chippedHold และการเล่นในเบราว์เซอร์ตรงกับ headless บน orbit-s-v3
- `bot-golden` ตรงทุก move 11 เกม และเกมของ weight ที่ tune แล้ว 20 เกมเหมือนเดิม
- `tsc`, `features-test`, `determinism-test`, `versus-test`, `render-smoke`, `vite build` ผ่าน; blueprint orbit ทั้ง 6 แบบ validate ผ่าน

## ยังไม่ได้ทำ

- test ของ `qualityFirst` ยังอ่อน: การอัป tower ในเกมทดสอบเกิดหลัง quality ถึงขั้นสูงสุดแล้ว
- บอทยังตายที่บอสด่าน 28 (Summon Air) และอากาศด่าน 32 ยังไม่ได้วิเคราะห์ลึก
- ยังไม่ได้เปิดดูตาราง Leaderboard ในเบราว์เซอร์จริง (ทดสอบแค่ endpoint)
