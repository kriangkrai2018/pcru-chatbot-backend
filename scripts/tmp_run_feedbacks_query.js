const mysql = require('mysql2/promise');
require('dotenv').config();

(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response'
  });
  try{
    const [rows] = await conn.query(
      `SELECT 
                f.FeedbackID, 
                f.FeedbackValue, 
                f.Timestamp, 
                f.ChatLogID,
                f.FeedbackReason,
                f.FeedbackComment,
                f.HandledAt,
                c.UserQuery,
                qa.QuestionText,
                qa.QuestionsAnswersID
             FROM Feedbacks f
             LEFT JOIN ChatLogHasAnswers c ON f.ChatLogID = c.ChatLogID
             LEFT JOIN QuestionsAnswers qa ON c.QuestionsAnswersID = qa.QuestionsAnswersID
             WHERE f.HandledAt IS NULL
             ORDER BY f.Timestamp DESC`
    );
    console.log('Rows length:', rows.length);
    console.log(rows.slice(0,5));
  }catch(e){
    console.error('query error:', e.message || e);
  }
  await conn.end();
})();