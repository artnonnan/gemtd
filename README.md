# Gem TD — Browser Prototype

เกม Tower Defense แบบ maze เล่นบน browser ได้แรงบันดาลใจจากแมพ **[BK's] Gem TD** (Warcraft III, by Bryvx) ตัวเลขของ gem, สูตร special และ wave ทั้ง 50 เลเวลดึงมาจากไฟล์แมพ `[BK's] Gem TD v7.9.w3x` โดยตรง

> สถานะ: **prototype** มีระบบหลักครบ แต่ยังไม่ได้ปรับ balance และยังไม่มี slate, damage test, race mode, extra chance และมินิเกมพนัน

## วิธีเล่น

1. แต่ละรอบให้คลิกช่องว่างบนบอร์ดเพื่อวาง gem แบบสุ่ม 5 เม็ด ระบบจะไม่ให้วางในจุดที่ทำให้ทางเดินถูกปิด
2. เลือก gem 1 เม็ดจาก 5 เม็ดนั้น แล้วกดอย่างใดอย่างหนึ่ง:
   - **Keep:** เก็บไว้
   - **Combine:** รวม gem ชนิดเดียวกัน 2 เม็ดเพื่อขึ้นคุณภาพ 1 ขั้น หรือ 4 เม็ดเพื่อขึ้น 2 ขั้น
   - **Special:** ถ้ามีวัตถุดิบครบตามสูตร จะสร้าง special tower (ดูสูตรได้ในแผง "Special recipes")
3. Gem ที่เหลือจะกลายเป็นหินที่ใช้ทำ maze จากนั้น wave จะเริ่ม ครีปมา 10 ตัวและต้องเดินผ่านจุด S → 1 → 2 → 3 → 4 → 5 → M (Mine)
4. ใช้ทองที่ได้ไปเพิ่ม **Gem quality** ที่ Mine เพื่อให้สุ่มได้ gem คุณภาพสูงขึ้น หรืออัปเกรด special tower
5. คำสั่งเสริมที่มีในแมพต้นฉบับ:
   - **Keep ↓ (Downgrade):** เก็บ gem คุณภาพ Flawed ถึง Perfect โดยลดลง 1 ขั้น เหมาะกับตอนที่สูตร special ต้องใช้คุณภาพต่ำกว่า
   - **Remove rock:** คลิกหินแล้วกด Remove (หรือกด `R`) ฟรีและใช้ได้ตลอดเวลา
   - **Swap (200g):** tower ระดับสูงบางตัว เช่น Black Opal, Gold, Fire Star และ Lucky China Jade สลับที่กับ gem อื่นหรือหินได้ ครั้งเดียวต่อ tower และได้สิทธิ์ใหม่เมื่ออัปเกรด

### Versus ออนไลน์ 2 คน

1. คนแรกกด **Host game** แล้วจะได้รหัสห้อง 5 ตัวอักษร จากนั้นส่งรหัสหรือกด **Copy invite link** แล้วส่งลิงก์ (`?room=CODE`) ให้เพื่อน
2. เพื่อนกรอกรหัสแล้วกด **Join** หรือเปิดลิงก์ เมื่อเชื่อมต่อได้แล้วเกมจะเริ่มใหม่ทั้งสองฝั่งพร้อมกัน
3. ทั้งสองคนได้ **gem ลำดับเดียวกัน** (ใช้ seed เดียวกัน) แต่เล่นบนบอร์ดของตัวเอง และเห็นบอร์ดของอีกฝ่ายเป็นภาพเล็กในแผงด้านข้าง
4. wave ของแต่ละเลเวลจะเริ่มเมื่อ**ทั้งสองคนเลือก gem เสร็จแล้ว** ใครอยู่รอดนานกว่าชนะ ถ้ารอดทั้งคู่จะเทียบเลเวล, lives และ kills ตามลำดับ
5. ระหว่างแข่งจะปิดการ pause และการเร่งความเร็ว เฉพาะ host ที่เปลี่ยนความยากหรือ restart ได้ ถ้าอีกฝ่ายหลุด จะเล่นต่อคนเดียวได้

เบื้องหลังใช้ [PeerJS](https://peerjs.com) (WebRTC data channel) และใช้ signalling server สาธารณะของ PeerJS ไม่ต้องมี backend ของเราเอง จึงยัง deploy บน Vercel แบบ static ได้ ข้อจำกัดคือไม่มี TURN server ถ้าทั้งสองฝั่งอยู่หลัง NAT แบบเข้มงวด (เช่นเครือข่ายบริษัทบางแห่ง) อาจเชื่อมต่อไม่ได้

ปุ่มลัด: `Space` หยุด/เล่นต่อ · `1` `2` `4` เปลี่ยนความเร็ว · `K` Keep gem ที่เลือกอยู่ · `Esc` ยกเลิกการเลือก

## พัฒนา

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + build ไปที่ dist/
npm run simulate -- 5 --smart --difficulty=easy   # ให้ bot เล่นแบบ headless เพื่อทดสอบ logic และ balance
npm run versus-test   # ทดสอบ logic ของ versus โดยต่อ 2 ฝั่งผ่าน channel ในหน่วยความจำ
npm run features-test # ทดสอบ Remove rock, Downgrade และ Swap
```

ต้องใช้ Node 18 ขึ้นไป

## Deploy บน Vercel

repo นี้มี [vercel.json](vercel.json) ตั้งค่าไว้แล้ว (framework Vite, output `dist`):

1. ไปที่ vercel.com → **Add New Project** → import repo `artnonnan/gemtd`
2. กด **Deploy** โดยไม่ต้องตั้งค่าเพิ่ม หลังจากนั้นทุกครั้งที่ push ขึ้น `main` ระบบจะ deploy ให้อัตโนมัติ

หรือ deploy ผ่าน CLI ด้วย `npx vercel --prod`

## โครงสร้าง

```
src/
  data/towers.json   ค่าสถานะ tower 114 ตัว (generated จาก war3map.w3u)
  data/waves.json    ครีป 50 เลเวล (generated จาก war3map.w3u + war3map.j)
  data/gems.ts       ประเภท gem, คุณภาพ, สูตร special, ability ของแต่ละ tower
  game/config.ts     ขนาดบอร์ด, checkpoint, ค่าคงที่ต่าง ๆ
  game/path.ts       A* pathfinding และการตรวจว่า maze ถูกปิดหรือไม่
  game/game.ts       state ของเกม, กติกา, การจำลองการต่อสู้ (fixed timestep)
  game/rng.ts        seeded PRNG สำหรับสุ่ม gem (versus ใช้ seed เดียวกัน)
  net/session.ts     PeerJS wrapper (host/join) และ message protocol
  net/match.ts       ควบคุม versus: sync การเริ่ม wave, ส่ง snapshot, ตัดสินผล
  render/renderer.ts วาดภาพด้วย Canvas 2D
  render/mini.ts     มุมมองบอร์ดของคู่แข่ง (จาก snapshot)
  ui/panel.ts        แผง HUD
  main.ts            game loop และ input
scripts/simulate.ts  bot สำหรับเล่นแบบ headless
```

**กติกาที่ยึดตามแมพต้นฉบับ:** สูตรคำนวณเกราะของ WC3, aura ชนิดเดียวกันไม่ stack, ได้โบนัสดาเมจ +10% ทุก 10 kill (สูงสุด +120%), bounty = `ubba + 1`, ครีปเข้า Mine แล้วลด lives ตาม point value (`upoi`), lives สูงสุด 50, ความยาก Easy/Normal/Hard ปรับเกราะครีป −3/−1/+2

**ค่าที่ประมาณเอง:** 1 ช่องบนบอร์ด = 128 WC3 units, ตำแหน่ง checkpoint, สถานะของ gem ระดับ mod ที่อ่านจาก tooltip และ Chipped Ruby ที่ปรับ cooldown เป็น 0.8s (ในข้อมูลแมพเป็น 0.1s)

## การ regenerate ข้อมูลจากแมพ

ใช้สคริปต์ในโฟลเดอร์ `w3x` ([EXTRACT_W3X.md](../w3x/EXTRACT_W3X.md)):

```bash
python -I extract_w3x.py "[BK's] Gem TD v7.9.w3x" extracted
python -I parse_objects.py extracted/war3map.w3u extracted/war3map.w3u.json
python -I export_towers.py extracted/war3map.w3u.json ../gemtd/src/data/towers.json extracted/war3map.j ../gemtd/src/data/waves.json
```

---
Fan prototype ที่ไม่ได้ใช้ asset ใด ๆ จาก Warcraft III ชื่อและตัวเลขของ gem อ้างอิงจากแมพ [BK's] Gem TD ของ Bryvx
