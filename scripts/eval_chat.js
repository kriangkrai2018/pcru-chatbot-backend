// Simple evaluation harness for /chat/respond using TEST_CASES.md
// Reads specific queries and prints summary metrics and samples

const fs = require('fs');
const path = require('path');
const http = require('http');

const TEST_FILE = path.join(__dirname, '..', 'TEST_CASES.md');

const QUERIES = [
  // Group 1
  { name: 'Exact', q: 'ทุนเรียนดีมีกี่อย่าง?', expectTitleIncludes: 'ทุนเรียนดีมีกี่อย่าง' },
  { name: 'Semantic', q: 'สมัครทุนเรียนดีต้องเอกสารอะไร', expectTitleIncludes: 'เอกสาร' },
  { name: 'Synonym', q: 'หอใน ที่พักไหน', expectMinResults: 1 },
  // Group 2 (Auto-learn style proxies)
  { name: 'Natural New', q: 'ใบสมัครทุนเรียนดีใช้อะไรบ้าง', expectMinResults: 3 },
  { name: 'Reuse Learned', q: 'บ้าง', expectMinResults: 3 },
  { name: 'Variant', q: 'เอกสารสมัครทุนไรบ้าง', expectTitleIncludes: 'เอกสาร' },
  // Group 3 (Dedup hints via search behavior)
  { name: 'Short Generic', q: 'ทุน', expectMinResults: 3 },
  // Advanced
  { name: 'Mixed Thai', q: 'ทุนศึกษาต่อต่างประเทศมีไหม บ้าน ไร', expectMinResults: 1 },
  { name: 'Long Query', q: 'ผมเป็นนักศึกษาชั้นเทพบุรี ขอสมัครทุนเรียนดีได้ไหม ต้องเตรียมอะไรบ้าง', expectMinResults: 3 },
  { name: 'Typo Variant', q: 'สมัครทุน (ไม่มีเทอมที่เหมือนเดิม)', expectMinResults: 1 }
];

function postJSON(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('🧪 Running chat evaluation...');
  const results = [];
  for (const q of QUERIES) {
    try {
      const resp = await postJSON('http://project.3bbddns.com:3000/chat/respond', { message: q.q });
      const alts = resp.alternatives || [];
      const top = alts[0] || {};
      const okTitle = q.expectTitleIncludes ? (String(top.title || '').includes(q.expectTitleIncludes)) : true;
      const okCount = q.expectMinResults ? (alts.length >= q.expectMinResults) : true;
      const pass = !!resp.found && okTitle && okCount;
      results.push({ name: q.name, query: q.q, found: resp.found, multiple: resp.multipleResults, count: alts.length, topTitle: top.title || '', pass });
    } catch (err) {
      results.push({ name: q.name, query: q.q, error: String(err) });
    }
  }
  const passed = results.filter(r => r.pass).length;
  console.log('\n📊 Summary:');
  console.table(results.map(r => ({ Test: r.name, Found: r.found, Multiple: r.multiple, Count: r.count, TopTitle: r.topTitle, Pass: r.pass })));
  console.log(`\n✅ Passed ${passed}/${results.length}`);
})();
