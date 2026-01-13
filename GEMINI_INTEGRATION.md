# 🚀 Gemini AI Integration Guide

## ภาพรวมการใช้งาน

```
Frontend (Vue.js)
    ↓ ส่ง message
Backend (Node.js)
    ↓
[Respond Endpoint] (/chat/respond)
    ↓
┌─────────────────────────────────────┐
│ 1. ลองค้นหาจากระบบเดิม            │
│    (Keyword Matching)               │
└─────────────────────────────────────┘
    ↓
 ได้คำตอบหรือไม่?
    ├─ ได้ → [ปรับปรุง ด้วย AI]
    │       ↓
    │      ✅ ส่งคำตอบกลับไป
    │
    └─ ไม่ได้ → [ให้ AI ตอบ] (Gemini API)
            ↓
           ✅ ส่งคำตอบจาก AI
```

## 3 วิธีการ Integrate

### 📌 วิธี 1: Fallback Mode (ต่ำที่สุด)
- ใช้ระบบเดิม ถ้าไม่มีคำตอบ ให้ AI ตอบ
- **ข้อดี**: ง่าย ใช้ AI น้อย ราคาถูก
- **ข้อเสีย**: ไม่ปรับปรุงคำตอบเดิม

```javascript
const result = await respondWithAIFallback(question, foundAnswers, category);
```

### 📌 วิธี 2: Enhance Mode (กลาง)
- ปรับปรุงคำตอบจากระบบเดิม ให้ดูธรรมชาติ
- **ข้อดี**: คำตอบดีขึ้น ยังคง keyword-matching
- **ข้อเสีย**: ต้องใช้ AI เสมอ ราคาแพง

```javascript
const result = await respondWithAIEnhance(question, foundAnswers, category);
```

### 📌 วิธี 3: Hybrid Mode (แนะนำ) ⭐
- ปรับปรุงคำตอบเดิม ถ้าไม่มี ให้ AI ตอบ
- **ข้อดี**: ทำไมไร่ดีที่สุด ใช้ AI ปานกลาง
- **ข้อเสีย**: ค่ะแรงกว่าเดิม

```javascript
const result = await respondWithAIHybrid(question, foundAnswers, category);
```

---

## 📝 วิธีการ Implement

### Step 1: Import modules ใน respond.js
```javascript
// ที่บรรทัดแรกของ respond.js
const geminiIntegration = require('./geminiIntegration');
```

### Step 2: หาจุดที่ส่ง response กลับไป
```javascript
// ค้นหาบรรทัดเช่นนี้ใน respond.js
res.json({ success: true, answers: foundAnswers });
```

### Step 3: เปลี่ยนจาก:
```javascript
res.json({ success: true, answers: foundAnswers });
```

### Step 3 (continued): เป็น:
```javascript
// Hybrid Mode (แนะนำ)
const result = await respondWithAIHybrid(
  req.body.question,      // ค่อนไหนจาก request
  foundAnswers,           // คำตอบจากระบบเดิม
  req.body.category || 'general'  // หมวดหมู่ (ถ้ามี)
);
res.json(result);
```

---

## 🔧 ตัวอย่างการใช้ REST API โดยตรง

### ทดสอบจาก Frontend ได้เลย:
```javascript
// ส่งคำถามไปยัง AI
const response = await fetch('http://localhost:36145/api/gemini/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'สวัสดี' })
});

const data = await response.json();
console.log(data.message); // คำตอบจาก AI
```

---

## 📊 คำตอบที่ได้จาก API

### ตัวอย่าง Response:
```json
{
  "success": true,
  "answers": [
    {
      "QuestionTitle": "ชื่อคำถาม",
      "QuestionText": "คำถามเต็ม",
      "AnswerText": "คำตอบ",
      "enhanced": true,  // ถ้าปรับปรุงด้วย AI
      "source": "ai-enhanced" // แหล่งที่มา
    }
  ],
  "source": "ai-enhanced" // ai / keyword-matching / ai-enhanced
}
```

---

## 💰 การบันทึก Token Usage

ทุกครั้งที่ใช้ AI API จะบันทึก:
- `promptTokens`: จำนวน token ในคำถาม
- `candidateTokens`: จำนวน token ในคำตอบ
- `totalTokens`: รวมทั้งหมด

ตัวอย่าง:
```
Prompt: "สวัสดี" = 87 tokens
Candidate: "สวัสดีครับ" = 3 tokens
Total = 90 tokens
```

---

## ❓ FAQ

**Q: ค่าใช้ Google Gemini API เท่าไหร่?**
A: Free tier ได้ 60 requests/นาที ไม่ต้องเสียเงิน

**Q: ควรใช้วิธีไหน?**
A: Hybrid Mode ดีที่สุด เพราะสมดุลระหว่างคุณภาพและค่าใช้

**Q: Frontend จะเพิ่ม Loading ไหม?**
A: ใช่ การใช้ AI จะช้ากว่า 1-2 วินาที

**Q: ทำให้ระบบเดิมเสียหาย ไหม?**
A: ไม่ เพราะเพิ่มแบบ additive (เพิ่มเติม ไม่ลบ)

---

## 📞 ติดต่อ
ถ้า error ก็ดูที่ logs:
```bash
tail -f /tmp/backend.log
```
