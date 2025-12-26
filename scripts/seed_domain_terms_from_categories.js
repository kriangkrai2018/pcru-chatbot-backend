#!/usr/bin/env node
/**
 * Script to auto-populate domain terms from existing QA Categories
 * 🆕 This learns domain terms from QuestionTitle keywords + Categories
 * 
 * For example:
 * - QA with title "ข่าวใหม่" and category "ทุนเรียนดี" 
 *   → learns "ข่าว" as a term in "ทุนเรียนดี" domain
 * 
 * Usage: 
 *   node scripts/seed_domain_terms_from_categories.js [--dry-run]
 */

const mysql = require('mysql2/promise');
const config = require('../config');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

/**
 * Normalize category name to domain name
 */
const categoryToDomain = (categoryName) => {
  if (!categoryName) return null;
  const cat = String(categoryName).toLowerCase().trim();
  
  // Map common category names to domains
  if (cat.includes('ทุน') || cat.includes('scholarship')) return 'scholarship';
  if (cat.includes('หอพัก') || cat.includes('หอ') || cat.includes('dorm')) return 'dorm';
  if (cat.includes('รับสมัคร') || cat.includes('admission') || cat.includes('สมัครเรียน')) return 'admissions';
  
  // Use category name itself as domain (cleaned up)
  return cat.replace(/\s+/g, '_').replace(/[^a-z0-9_ก-๙]/gi, '').substring(0, 50);
};

/**
 * Extract significant words from title (simple tokenization)
 * Extracts individual Thai words, not whole phrases
 */
const extractKeywords = (title) => {
  if (!title) return [];
  
  // Common Thai stopwords to skip
  const stopwords = new Set([
    'คือ', 'มี', 'ที่', 'ใน', 'ของ', 'และ', 'หรือ', 'จะ', 'ได้', 'ไม่', 'เป็น',
    'การ', 'ให้', 'กับ', 'จาก', 'ไป', 'มา', 'ว่า', 'นี้', 'อะไร', 'ไหน', 'เมื่อ',
    'ต้อง', 'ทำ', 'อยู่', 'แล้ว', 'กี่', 'อย่าง', 'แบบ', 'ประเภท', 'ใด', 'บ้าง',
    'เท่าไหร่', 'ใคร', 'อะไรบ้าง', 'ยังไง', 'เป็นไง', 'ไหม', 'เพื่อ', 'สำหรับ',
    'ขั้นตอน', 'วิธี', 'เงื่อนไข', 'ใช้', 'เอกสาร'
  ]);
  
  // Known domain-specific terms that should be kept as keywords
  const meaningfulTerms = [
    'ทุน', 'ทุนเรียนดี', 'ทุนการศึกษา', 'ทุนช่วยเหลือ', 'ทุนความสามารถพิเศษ',
    'หอพัก', 'หอ', 'ที่พัก', 'หอพักใน', 'หอพักนอก',
    'สมัครเรียน', 'รับสมัคร', 'เข้าศึกษา',
    'มหาวิทยาลัย', 'นักศึกษา', 'ต่างชาติ', 'ต่างประเทศ',
    'ค่าใช้จ่าย', 'เงิน', 'สิ่งอำนวยความสะดวก',
    'ปีการศึกษา', 'เปิดรับสมัคร'
    // Note: 'ข่าว' is NOT included here - it's not a domain-specific term
  ];
  
  const titleLower = title.toLowerCase();
  const keywords = new Set();
  
  // First, extract known meaningful terms
  for (const term of meaningfulTerms) {
    if (titleLower.includes(term.toLowerCase())) {
      keywords.add(term);
    }
  }
  
  // Then extract individual short words (2-6 chars) that aren't stopwords
  // Thai words are typically short
  const words = titleLower
    .replace(/[?!.,;:'"()\[\]{}0-9]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && w.length <= 10 && !stopwords.has(w));
  
  for (const word of words) {
    // Only add words that seem meaningful (not too generic)
    if (word.length >= 2) {
      keywords.add(word);
    }
  }
  
  return [...keywords];
};

/**
 * 🛡️ Check if a keyword is appropriate for a domain
 * Prevents adding unrelated keywords like "ข่าว" to scholarship domain
 */
const isKeywordAppropriateForDomain = (keyword, domain) => {
  if (!keyword || !domain) return false;
  
  const kwLower = keyword.toLowerCase();
  
  // Domain-specific term patterns
  const domainPatterns = {
    scholarship: ['ทุน', 'เรียนดี', 'การศึกษา', 'ช่วยเหลือ', 'กยศ', 'กรอ', 'ความสามารถ', 'ต่างชาติ'],
    dorm: ['หอ', 'พัก', 'ที่พัก', 'ห้อง', 'หอพัก'],
    admissions: ['สมัคร', 'รับ', 'เรียน', 'เข้าศึกษา', 'tcas', 'โควตา']
  };
  
  // Generic terms that can be in any domain
  const genericTerms = ['มหาวิทยาลัย', 'นักศึกษา', 'เงิน', 'ค่าใช้จ่าย', 'ปีการศึกษา', 'เปิดรับ'];
  
  // If it's a generic term, allow it
  if (genericTerms.some(t => kwLower.includes(t) || t.includes(kwLower))) {
    return true;
  }
  
  // Check if keyword matches domain patterns
  const patterns = domainPatterns[domain] || [];
  if (patterns.some(p => kwLower.includes(p) || p.includes(kwLower))) {
    return true;
  }
  
  // 🚫 Block obviously unrelated keywords
  const unrelatedTerms = {
    scholarship: ['ข่าว', 'หอพัก', 'หอ', 'ที่พัก'], // ข่าว is not scholarship-related
    dorm: ['ทุน', 'ข่าว', 'สมัครเรียน'],
    admissions: ['ทุน', 'หอพัก', 'ข่าว']
  };
  
  const blocked = unrelatedTerms[domain] || [];
  if (blocked.some(b => kwLower.includes(b) || b.includes(kwLower))) {
    return false;
  }
  
  return true;
};

async function main() {
  const pool = mysql.createPool({
    host: config.db?.host || process.env.DB_HOST || 'project.3bbddns.com',
    user: config.db?.user || process.env.DB_USER,
    password: config.db?.password || process.env.DB_PASSWORD,
    database: config.db?.database || process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  });

  try {
    console.log('🌐 Auto-populating domain terms from QA Categories...');
    console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will insert)'}\n`);

    // Get all QAs with their categories
    const [qas] = await pool.query(`
      SELECT 
        qa.QuestionsAnswersID,
        qa.QuestionTitle,
        qa.QuestionText,
        c.CategoriesName
      FROM QuestionsAnswers qa
      LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
      WHERE c.CategoriesName IS NOT NULL
    `);

    console.log(`📊 Found ${qas.length} QAs with categories\n`);

    // Track domain terms to add
    const domainTermsToAdd = new Map(); // domain -> Set of terms
    let blockedCount = 0;

    for (const qa of qas) {
      const domain = categoryToDomain(qa.CategoriesName);
      if (!domain) continue;

      const keywords = extractKeywords(qa.QuestionTitle);
      
      for (const keyword of keywords) {
        // 🛡️ Check if keyword is appropriate for this domain
        if (!isKeywordAppropriateForDomain(keyword, domain)) {
          console.log(`  🚫 Blocked: "${keyword}" is not appropriate for domain "${domain}"`);
          blockedCount++;
          continue;
        }
        
        if (!domainTermsToAdd.has(domain)) {
          domainTermsToAdd.set(domain, new Set());
        }
        domainTermsToAdd.get(domain).add(keyword);
      }
    }

    // Show summary
    console.log(`\n📋 Domain terms to add (${blockedCount} blocked):\n`);
    let totalToAdd = 0;
    
    for (const [domain, terms] of domainTermsToAdd.entries()) {
      console.log(`  🏷️ ${domain}: ${terms.size} terms`);
      console.log(`     ${[...terms].slice(0, 10).join(', ')}${terms.size > 10 ? '...' : ''}`);
      totalToAdd += terms.size;
    }

    console.log(`\n   Total: ${totalToAdd} domain terms\n`);

    if (totalToAdd === 0) {
      console.log('✅ No new domain terms to add!');
      return;
    }

    // Check existing terms to avoid duplicates
    const [existingTerms] = await pool.query(
      `SELECT Domain, LOWER(Term) as Term FROM IntentDomainTerms`
    );
    
    const existingSet = new Set(
      existingTerms.map(r => `${r.Domain}:${r.Term}`)
    );

    // Insert new terms
    let insertedCount = 0;
    let skippedCount = 0;

    for (const [domain, terms] of domainTermsToAdd.entries()) {
      for (const term of terms) {
        const key = `${domain}:${term.toLowerCase()}`;
        
        if (existingSet.has(key)) {
          skippedCount++;
          continue;
        }

        if (!dryRun) {
          try {
            await pool.query(
              `INSERT INTO IntentDomainTerms (Domain, Term, IsActive) VALUES (?, ?, 1)`,
              [domain, term]
            );
            insertedCount++;
            console.log(`  ✅ Added: "${term}" → ${domain}`);
          } catch (e) {
            if (!e.message?.includes('Duplicate')) {
              console.warn(`  ⚠️ Failed to add "${term}" to ${domain}: ${e.message}`);
            }
          }
        } else {
          insertedCount++;
          console.log(`  [DRY RUN] Would add: "${term}" → ${domain}`);
        }
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`   - Inserted: ${insertedCount}`);
    console.log(`   - Skipped (already exist): ${skippedCount}`);

    if (dryRun && insertedCount > 0) {
      console.log(`\n⚠️ DRY RUN: Run without --dry-run to actually insert`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
