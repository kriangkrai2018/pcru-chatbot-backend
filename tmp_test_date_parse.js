function toIsoDate(d){
  if(!d) return null;
  const str = String(d).trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

  const normalizeYear = (y) => {
    if (typeof y !== 'number') return y;
    if (y >= 2400 && y <= 3000) return y - 543;
    return y;
  };

  const m = str.match(/^([0-3]?\d)\s*[\/\.\-\s]\s*(1[0-2]|0?[1-9])\s*[\/\.\-\s]\s*((?:\d{2})|(?:\d{4}))$/);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    let yearRaw = parseInt(m[3], 10);

    let year = (String(m[3]).length === 2) ? (2000 + yearRaw) : yearRaw;
    year = normalizeYear(year);

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    const testDate = new Date(year, month - 1, day);
    if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) return null;

    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  try {
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const newYear = normalizeYear(y);
      if (newYear !== y) dt.setFullYear(newYear);
      return dt.toISOString().slice(0,10);
    }
  } catch (e) {}
  return null;
}
const tests=['24/12/2568','25/12/3000','24-12-2568','24.12.2568','24 / 12 / 2568','24\u200B/12/2568','24/12/68','24/02/2021','31/02/2568'];
for(const t of tests){ console.log(t,'=>',toIsoDate(t)); }
