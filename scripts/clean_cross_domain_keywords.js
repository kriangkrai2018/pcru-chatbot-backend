#!/usr/bin/env node
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

async function getPool() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  });
  return pool;
}

async function getDomainTerms(pool, domain) {
  const [rows] = await pool.query(
    `SELECT Term FROM IntentDomainTerms WHERE Domain = ? AND (IsActive IS NULL OR IsActive = 1)`,
    [domain]
  );
  return (rows || []).map(r => String(r.Term || '').toLowerCase());
}

function detectDomain(text, domains) {
  const t = String(text || '').toLowerCase();
  for (const [name, terms] of Object.entries(domains)) {
    if (terms.some(term => t.includes(term))) return name;
  }
  return null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dry = process.argv.includes('--dry-run') || !apply;

  const pool = await getPool();
  const domains = {
    dorm: await getDomainTerms(pool, 'dorm'),
    scholarship: await getDomainTerms(pool, 'scholarship'),
    admissions: await getDomainTerms(pool, 'admissions'),
  };

  const [rows] = await pool.query(
    `SELECT ak.QuestionsAnswersID, ak.KeywordID,
            qa.QuestionTitle, qa.QuestionText,
            k.KeywordText
     FROM AnswersKeywords ak
     JOIN QuestionsAnswers qa ON ak.QuestionsAnswersID = qa.QuestionsAnswersID
     JOIN Keywords k ON ak.KeywordID = k.KeywordID`
  );

  const conflicts = [];
  for (const r of rows) {
    const qaText = `${r.QuestionTitle || ''} ${r.QuestionText || ''}`;
    const qaDomain = detectDomain(qaText, domains);
    const kwDomain = detectDomain(r.KeywordText || '', domains);
    // Conflict if both domains exist and differ, or keyword has domain but QA doesn't
    if ((qaDomain && kwDomain && qaDomain !== kwDomain) || (!qaDomain && kwDomain)) {
      conflicts.push({
        qaId: r.QuestionsAnswersID,
        qaDomain,
        kwId: r.KeywordID,
        kwText: r.KeywordText,
        kwDomain,
        title: r.QuestionTitle,
      });
    }
  }

  console.log(`Found ${conflicts.length} cross-domain keyword links.`);
  conflicts.slice(0, 50).forEach((c, i) => {
    console.log(`${i+1}. QA#${c.qaId} (${c.qaDomain || 'none'}) ⇆ KW#${c.kwId}:${c.kwText} (${c.kwDomain || 'none'}) → ${c.title}`);
  });

  if (apply && conflicts.length > 0) {
    // Delete by composite key (QuestionsAnswersID, KeywordID)
    let deleted = 0;
    for (const c of conflicts) {
      const [res] = await pool.query(
        `DELETE FROM AnswersKeywords WHERE QuestionsAnswersID = ? AND KeywordID = ?`,
        [c.qaId, c.kwId]
      );
      deleted += res.affectedRows || 0;
    }
    console.log(`Deleted ${deleted} cross-domain links.`);
  } else {
    console.log('Dry-run mode: no changes applied. Use --apply to delete.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Cleanup failed:', err && err.message);
  process.exit(1);
});
