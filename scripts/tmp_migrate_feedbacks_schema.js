const mysql=require('mysql2/promise');
require('dotenv').config();
(async()=>{
  const conn=await mysql.createConnection({host:process.env.DB_HOST||'project.3bbddns.com',user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'pcru_auto_response'});
  try{
    await conn.query(`ALTER TABLE Feedbacks ADD COLUMN IF NOT EXISTS Timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER FeedbackValue, ADD COLUMN IF NOT EXISTS FeedbackReason VARCHAR(100) NULL AFTER FeedbackValue, ADD COLUMN IF NOT EXISTS FeedbackComment TEXT NULL AFTER FeedbackReason, ADD COLUMN IF NOT EXISTS HandledAt DATETIME NULL DEFAULT NULL AFTER FeedbackComment`);
    console.log('Added columns (if not existed)');
    await conn.query(`CREATE INDEX IF NOT EXISTS idx_feedbacks_reason ON Feedbacks(FeedbackReason)`);
    await conn.query(`CREATE INDEX IF NOT EXISTS idx_feedbacks_handled ON Feedbacks(HandledAt)`);
    console.log('Created indexes');
    await conn.query("UPDATE Feedbacks SET FeedbackReason = Reason WHERE (FeedbackReason IS NULL OR FeedbackReason='') AND Reason IS NOT NULL");
    await conn.query("UPDATE Feedbacks SET Timestamp = FeedbackDate WHERE (Timestamp IS NULL OR Timestamp='0000-00-00 00:00:00') AND FeedbackDate IS NOT NULL");
    await conn.query("UPDATE Feedbacks SET HandledAt = NOW() WHERE Handled = 1 AND HandledAt IS NULL");
    console.log('Backfilled data from old columns');
  }catch(e){console.error('migration error:',e.message||e);}
  await conn.end();
})();