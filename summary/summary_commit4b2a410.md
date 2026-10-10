# สรุป commit `4b2a410` — Watch the AI play in the browser

- **Branch:** `ai-sim` (ต่อจาก `c9a93bd`)
- **ขั้นในแผน AI:** ขั้นที่ 4 (โหมด B: ดู AI เล่นในเบราว์เซอร์) + ขั้นที่ 7 (replay เกมจาก batch)

## สรุปสั้น

1. ดูบอทเล่นในเบราว์เซอร์ด้วยค่าน้ำหนักชุดใดก็ได้: Settings → **AI auto-play** หรือเปิดลิงก์ `?ai=<id>&seed=<n>`
2. **ค่าน้ำหนักเดียวกัน + seed เดียวกัน = เกมเดียวกับใน `npm run batch` ทุก action** มีเทสต์ยืนยัน
3. รายงาน batch มีส่วน **"เกมที่น่าดู"**: ลิงก์ replay ของเกมแย่สุด 3 เกม ดีสุด 3 เกม และเกมกลางๆ
4. ระหว่าง AI เล่น ผู้เล่นเปลี่ยนเกมไม่ได้ แต่ยังคลิกดูข้อมูล tower ได้

## วิธีใช้

```bash
npm run dev
# แล้วเปิด http://localhost:5173/?ai=w3&seed=164   (หรือ ?ai=smart&seed=3&difficulty=hard)
```

หรือ Settings → AI auto-play:
- **ช่องค่าน้ำหนัก**: `w0`, `smart` หรือ id จาก `sim-runs/weights/` (เช่น `w12`) ซึ่งโหลดได้เฉพาะตอนรัน `npm run dev`
- **ช่อง seed**: ว่างไว้ = สุ่ม
- **▶ AI play** หรือ **JSON file…** (โหลดค่าน้ำหนักจากไฟล์ ใช้ได้ทั้งบน dev และเว็บที่ deploy แล้ว)
- ระหว่างเล่น: **■ Stop AI**, **↺ Replay** (seed เดิม เกมเดิม), **🔗 Copy link** (ลิงก์ replay ของเกมนี้), ความเร็ว 1/4/8/16x (คีย์ `8` ก็ได้)

## ทำไมเกมในเบราว์เซอร์ถึงตรงกับ batch

ปัญหา: ใน batch บอทเดินรวดเดียว แต่ในเบราว์เซอร์ต้องเว้นจังหวะให้คนดูทัน ถ้าการเว้นจังหวะทำให้ action ไปเกิดคนละ step กัน เกมจะเพี้ยน

วิธีแก้ (`src/ai/autoplay.ts`):
- **ช่วง build / choose**: เดินครั้งละ 1 action ทุก 0.35 วินาที (หารด้วยความเร็ว) ช่วงนี้เวลาของเกมไม่เดิน เพราะ `Game.update` ทำงานเฉพาะตอนมีเวฟ การรอจึงไม่เปลี่ยนอะไรเลย
- **ช่วงเวฟ**: ทำ action ทั้งหมดที่บอทต้องการ (อัป tower, ซื้อ life) **ก่อน `update(STEP)` ทุกครั้ง** เหมือน `runner.ts` เป๊ะ

**เทสต์** (`npm run ai-test`): จำลอง game loop แบบเบราว์เซอร์ด้วยเฟรมยาวไม่เท่ากัน (4–54 ms) และสุ่มสลับความเร็ว 1/4/16x แล้วเทียบผลจบ (phase, ด่าน, lives, ทอง, kills, เวลา, tower ทุกตัว) กับเกม headless: `w0` seed 1, 2 และ `smart` seed 3 **ตรงกันทุกค่า**

## ไฟล์ที่เปลี่ยน

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/ai/autoplay.ts` | **ใหม่**: `AutoPlay.frame()` (เดินตามจังหวะ), `beforeUpdate()` (action ช่วงเวฟ), `describeAction()` |
| `src/ai/loadWeights.ts` | **ใหม่**: `fetchWeights(id)` / `parseWeights(text)` สำหรับเบราว์เซอร์ |
| `src/main.ts` | `controls.ai` (start / stop / active / load), เรียก AutoPlay ใน game loop, รองรับ `?ai=&seed=&difficulty=`, ถ้า AI error จะหยุดและแสดงข้อความ, versus เริ่มเมื่อไรจะหยุด AI |
| `src/ui/panel.ts` | ส่วน AI auto-play ใน Settings, แสดง 🤖 ในแถบบน, ข้อความ phase บอกว่า AI กำลังทำอะไร, ปฏิเสธปุ่มที่เปลี่ยนเกมระหว่าง AI เล่น |
| `src/ui/input.ts` | ระหว่าง AI เล่น คลิกได้แค่เลือก tower / หิน (ไม่วาง ไม่ swap ไม่ teleport) และปุ่ม Place บนมือถือไม่ทำงาน |
| `src/style.css` | ช่อง input ของ AI, ปุ่มดูจางระหว่าง AI เล่น (`.ai-lock`) |
| `src/ai/report.ts`, `scripts/ai/main.ts` | ส่วน "เกมที่น่าดู" ในรายงาน batch, และ batch บันทึกค่าน้ำหนักลง `sim-runs/weights/` เพื่อให้เบราว์เซอร์โหลดได้ |

## รายละเอียดที่ควรรู้

- **Vite dev server ส่ง `index.html` เมื่อหาไฟล์ไม่เจอ** (SPA fallback) แทนที่จะเป็น 404 ตัวโหลดจึงเช็ค content-type ว่าเป็น JSON ด้วย ไม่งั้นจะได้ error ที่อ่านไม่รู้เรื่อง ("Unexpected token <")
- **บนเว็บที่ deploy แล้ว** ไม่มี `sim-runs/` ใช้ได้แค่ `w0`, `smart` และการโหลดไฟล์ JSON
- **การกันผู้เล่นแก้เกม** ทำ 3 ชั้น: ปุ่มดูจาง (CSS), `onAction` ปฏิเสธ action ที่เปลี่ยนเกม และคีย์ลัด K / R ไม่ทำงาน ปุ่ม Restart ยังกดได้ (เริ่มเกมใหม่แบบผู้เล่นเล่นเอง และหยุด AI)
- **ตรวจด้วยเบราว์เซอร์จริงแบบจำกัด**: ใช้ Chrome headless ถ่ายภาพลิงก์ `?ai=w3&seed=164` และ `?ai=smart&seed=3` เห็นว่าโหลดค่าน้ำหนัก, เริ่มเกมด้วย seed นั้น, วางเจมแรกถูกตำแหน่ง และแถบสถานะถูกต้อง แต่ headless Chrome ไม่เดิน animation loop ต่อ จึงยังไม่ได้ดูเกมทั้งเกมในเบราว์เซอร์จริง ส่วนตรรกะทั้งเกมยืนยันด้วยเทสต์ด้านบน **ควรลองเปิดดูเองสักครั้ง**

## เทสต์

- `ai-test` (รวมเทสต์ใหม่), `determinism-test`, `features-test`, `versus-test`, `render-smoke`, `bot-golden --check` และ `npm run build` ผ่านทั้งหมด
- `versus-test` สุ่ม seed ใหม่ทุกครั้ง ด่านที่จบจึงต่างกันไปแต่ละรอบ (ปกติ) ส่วน assertion ทั้ง 8 ข้อผ่านทุกครั้ง

## สถานะของแผนทั้งหมด

| ขั้น | งาน | commit |
|---|---|---|
| 1 | combat deterministic | `9bd8796` |
| 2 | บอทเป็นโมดูล + เร็วขึ้น ~20 เท่า | `092b05a` |
| 3 | recorder + analyzer | `0c93154` |
| 4 | ดู AI เล่นในเบราว์เซอร์ | `4b2a410` |
| 5 | batch CLI ขนานหลาย core | `c9a93bd` |
| 6 | tuner + รายงาน + LLM ที่ปรึกษา (ทำมือ) | `c9a93bd` |
| 7 | replay เกมจาก batch | `4b2a410` |
| 6b | เรียก API ของ LLM อัตโนมัติ | ยังไม่ทำ (รอผลจากการใช้แบบทำมือ) |
