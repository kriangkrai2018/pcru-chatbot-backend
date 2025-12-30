// services/QuestionsAnswers/dateUtils.js

// Helper: แปลงปี พ.ศ. (BE) -> ค.ศ. (CE)
const normalizeYear = (y) => {
    let yr = parseInt(y, 10);
    // ถ้าปีอยู่ในช่วง 2400-3000 (พ.ศ. ปัจจุบันและใกล้เคียง) ให้ลบ 543
    if (yr >= 2400 && yr <= 3000) {
        console.log(`[dateUtils] Converting BE year ${yr} -> ${yr - 543}`);
        return yr - 543;
    }
    return yr;
};

// ReviewDate must not be NULL in DB — use provided date or default to today
const toIsoDate = (d) => {
    if (!d) return null;
    // ลบช่องว่างหัวท้ายและอักขระพิเศษ
    let str = String(d).trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

    // แปลงเดือนไทยเป็นตัวเลข (เผื่อกรณีไฟล์มี format แบบไทย)
    const thaiMonths = {
        'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04', 'พ.ค.': '05', 'มิ.ย.': '06',
        'ก.ค.': '07', 'ส.ค.': '08', 'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12'
    };
    for (const [tm, num] of Object.entries(thaiMonths)) {
        str = str.replace(new RegExp(tm, 'g'), `/${num}/`);
    }

    // จับรูปแบบที่มีตัวเลข 3 กลุ่ม คั่นด้วย / - . หรือช่องว่าง
    // รองรับทั้ง DD/MM/YYYY และ YYYY-MM-DD
    const m = str.match(/^(\d{1,4})[\/\-\.\s]+(\d{1,2})[\/\-\.\s]+(\d{1,4})(?:.*)?$/);
    if (m) {
        let v1 = parseInt(m[1], 10);
        let v2 = parseInt(m[2], 10);
        let v3 = parseInt(m[3], 10);

        let day, month, year;

        // เดาว่ารูปแบบไหน (YYYY ขึ้นต้น หรือ ลงท้าย)
        if (v1 > 31) {
            // YYYY-MM-DD
            year = v1;
            month = v2;
            day = v3;
        } else {
            // DD-MM-YYYY (หรือ MM-DD-YYYY แต่เราให้ DD มาก่อนสำหรับบริบทไทย)
            day = v1;
            month = v2;
            year = v3;
        }

        // ถ้าปีมา 2 หลัก ให้ตีว่าเป็น 20xx
        if (year < 100) year += 2000;

        // แปลง พ.ศ. -> ค.ศ.
        year = normalizeYear(year);
        
        // ตรวจสอบความถูกต้องของวัน/เดือน
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const testDate = new Date(year, month - 1, day);
            if (testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day) {
                const mm = String(month).padStart(2, '0');
                const dd = String(day).padStart(2, '0');
                return `${year}-${mm}-${dd}`;
            }
        }
    }
    
    // Fallback: ใช้ Date parser ปกติ (สำหรับ format แปลกๆ ที่ regex ไม่จับ)
    try {
        const dt = new Date(str);
        if (!isNaN(dt.getTime())) {
            let y = dt.getFullYear();
            const newYear = normalizeYear(y);
            if (newYear !== y) {
                dt.setFullYear(newYear);
            }
            // สร้าง string เองเพื่อเลี่ยงปัญหา Timezone ที่อาจลดวันที่ลง 1 วัน
            const yyyy = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const dd = String(dt.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
    } catch(e){}
    return null;
};

module.exports = { toIsoDate };