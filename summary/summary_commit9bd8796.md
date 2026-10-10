# สรุป commit `9bd8796` — Make combat deterministic per seed

- **Branch:** `ai-sim` (แตกจาก `main` ที่ `741cfae`)
- **ขั้นในแผน AI:** ขั้นที่ 1 จาก 7

## เป้าหมาย

ทำให้ **seed เดียวกัน + action ชุดเดียวกัน = เกมเดียวกันทุกครั้ง** ถ้าไม่มีข้อนี้ จะเทียบค่าน้ำหนักบอทสองชุดไม่ได้ เพราะผลต่างอาจมาจากโชคแทนที่จะมาจากค่าน้ำหนัก และ replay เกมก็ทำไม่ได้

## ปัญหาที่เจอก่อนแก้

1. **Combat ใช้ `Math.random()` ตรงๆ 8 จุด** ใน `src/game/game.ts` ได้แก่ ทอยดาเมจ, crit, nova, lucky gold, spells (2 จุด) และ stun ผลจึงต่างกันทุกครั้งแม้ seed เดียวกัน
2. **Timestep ไม่ตรงกัน**: เบราว์เซอร์ใช้ `1/60` แต่ `scripts/simulate.ts` ใช้ `1/30` ทำให้ seed เดียวกันให้ผลต่างกันระหว่างสองที่
3. **บอทใน `simulate.ts` ใช้ `Math.random()`** ตอนตัดสินช่องที่คะแนนเท่ากัน

## สิ่งที่แก้

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/game/rng.ts` | เพิ่ม `combatSeed(seed)` สร้าง seed ของ combat จาก seed หลัก (`seed ^ 0x9e3779b9`) |
| `src/game/game.ts` | เพิ่ม `combatRng` แล้วเปลี่ยน `Math.random()` ทั้ง 8 จุดไปใช้ตัวนี้, เพิ่ม `readonly seed` แบบ public |
| `src/game/config.ts` | เพิ่ม `STEP = 1/60` เป็นค่ากลางค่าเดียว |
| `src/main.ts` | เลิกประกาศ `STEP` เอง ไปใช้จาก `config.ts` |
| `scripts/simulate.ts` | ใช้ `STEP`, รอบที่ r ใช้ seed = `--seed` + r (ค่าเริ่มต้น 1), บอทใช้ RNG ที่มี seed |
| `scripts/determinism-test.ts` | **ไฟล์ใหม่**: เทสต์ความ deterministic |
| `package.json` | เพิ่ม `npm run determinism-test` |

### ทำไม combat ใช้ RNG แยกจากการสุ่มเจม

โหมด versus ให้ผู้เล่นสองคนใช้ seed เดียวกันเพื่อให้ได้เจมชุดเดียวกัน ถ้า combat ใช้ stream เดียวกับการสุ่มเจม จำนวนครั้งที่ tower ยิงจะไปเลื่อนลำดับเจมรอบถัดไป แล้วสองฝั่งจะได้เจมไม่เหมือนกัน การแยกเป็นสอง stream จึงคงพฤติกรรมของ versus ไว้

## เทสต์ (`npm run determinism-test`)

1. ระหว่างเล่นต้องไม่มีการเรียก `Math.random` เลย (เทสต์แทน `Math.random` ด้วยฟังก์ชันที่ throw)
2. seed 1, 42, 9001 เล่นสองครั้งได้ผลตรงกันทุกเวฟ (level, lives, gold, kills, เวลา, tower ทุกตัว)
3. seed ต่างกันได้เกมต่างกัน
4. การต่อสู้ที่ต่างกันไม่ทำให้เจมรอบถัดไปเปลี่ยน (โหมด versus ต้องการข้อนี้)

**ผล:** ผ่านทั้งหมด เทสต์เดิม (`features-test`, `versus-test`, `render-smoke`) และ `tsc` ผ่านด้วย รัน `npm run simulate -- 3` สองครั้ง ผลออกมาเหมือนกันทุกตัวอักษร

## ผลกระทบที่ควรรู้

- ตัวเลขจาก `simulate` **เทียบกับก่อน commit นี้ไม่ได้** เพราะ timestep เปลี่ยนจาก 1/30 เป็น 1/60
- เกมในเบราว์เซอร์ยังสุ่ม seed ใหม่ทุกเกมเหมือนเดิม ผู้เล่นไม่เห็นความต่าง
