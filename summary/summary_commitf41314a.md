# สรุป commit `f41314a` — Add Vercel Analytics

- **Branch:** `main` (ต่อจาก `e0906dd`)
- **ประเภท:** เพิ่มการเก็บสถิติผู้เข้าชม ไม่เปลี่ยนตัวเกม

## ที่ทำ

- ติดตั้ง `@vercel/analytics` (`^2.0.1`) ใน `dependencies`
- `src/main.ts` เรียก `inject()` ครั้งเดียวตอนแอปเริ่ม เกมเป็น Vite ธรรมดา ไม่มี layout แบบ Next.js จุดนี้จึงเทียบได้กับ layout

## ต้องทำบน Vercel

- เปิด Analytics ในหน้าโปรเจกต์ (แท็บ Analytics → Enable)
- deploy แล้วเข้าเว็บ ข้อมูลจะเข้าภายในประมาณ 30 วินาที (ad blocker อาจบล็อก)
- ตอน `npm run dev` สคริปต์ทำงานแบบ debug ไม่ส่งข้อมูลจริง

## เทสต์

`npm run build` (tsc + vite build) ผ่าน

## หมายเหตุ

ตอนติดตั้ง npm รายงานช่องโหว่ 16 รายการ (high 2) ใน dependency ของโปรเจกต์ ยังไม่ได้ตรวจว่ามาจากแพ็กเกจไหน
