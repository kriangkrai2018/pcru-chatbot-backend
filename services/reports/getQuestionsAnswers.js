/**
 * Service to get all QuestionsAnswers for the logged-in officer.
 * @param {object} pool - MySQL connection pool
 * @returns {function} - Express middleware (req, res)
 */
const getQuestionsAnswersService = (pool) => async (req, res) => {
    // debug toggle: set DEBUG_GETQA=true to enable internal debug logs
    const debugGETQA = true; // Force enable for debugging
    const dbg = (...args) => { if (debugGETQA) console.log(...args); };
    let connection;
    try {
        const officerId = (req.user?.userId ?? req.user?.officerId);
        const userRole = req.user?.role;
        console.log('🔍 getQuestionsAnswers called for officerId:', officerId, 'role:', userRole, 'raw user:', req.user);
        
        // Allow admins to see all questions, officers only see their own
        const isAdmin = userRole === 'Super Admin' || userRole === 'Admin';
        const targetOfficerId = isAdmin ? null : officerId;
        
        if (!isAdmin && !officerId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Could not identify the user from the token.' });
        }

        connection = await pool.getConnection();
        dbg('✅ Got database connection');

        // Get QuestionsAnswers (always order by QuestionsAnswersID DESC)
        dbg('📝 Fetching questions for officer:', targetOfficerId || 'ALL (admin)');
        let query, params;
        if (isAdmin) {
            // Admin sees all questions
                query = `SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.ReviewDate, qa.QuestionText, qa.OfficerID,
                    qa.CategoriesID, c.CategoriesName
                 FROM QuestionsAnswers qa
                 LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
                 ORDER BY qa.QuestionsAnswersID DESC`;
            params = [];
        } else {
            // Officer sees only their questions
                query = `SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.ReviewDate, qa.QuestionText, qa.OfficerID,
                    qa.CategoriesID, c.CategoriesName
                 FROM QuestionsAnswers qa
                 LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
                 WHERE qa.OfficerID = ?
                 ORDER BY qa.QuestionsAnswersID DESC`;
            params = [targetOfficerId];
        }
        const [rows] = await connection.query(query, params);
        dbg('✅ Found', rows.length, 'questions');

        // Get keywords and feedback counts for each question
        const questionsWithKeywords = await Promise.all(
            rows.map(async (question) => {
                try {
                    dbg('🔍 Fetching keywords for question:', question.QuestionsAnswersID);
                    const [keywords] = await connection.query(
                        `SELECT k.KeywordID, k.KeywordText 
                         FROM Keywords k
                         INNER JOIN AnswersKeywords ak ON k.KeywordID = ak.KeywordID
                         WHERE ak.QuestionsAnswersID = ?`,
                        [question.QuestionsAnswersID]
                    );
                    dbg('✅ Found', keywords.length, 'keywords for question', question.QuestionsAnswersID);
                    
                    // Get like/unlike/pending counts for this question
                    dbg('🔍 Fetching feedback counts for question:', question.QuestionsAnswersID);
                    const [feedbackCounts] = await connection.query(
                        `SELECT 
                            SUM(CASE WHEN f.FeedbackValue = 1 THEN 1 ELSE 0 END) as likeCount,
                            SUM(CASE WHEN f.FeedbackValue = 0 AND f.HandledAt IS NULL THEN 1 ELSE 0 END) as unlikeCount,
                            SUM(CASE WHEN f.FeedbackValue = 2 THEN 1 ELSE 0 END) as pendingCount
                         FROM Feedbacks f
                         INNER JOIN ChatLogHasAnswers c ON f.ChatLogID = c.ChatLogID
                         WHERE c.QuestionsAnswersID = ?`,
                        [question.QuestionsAnswersID]
                    );
                    
                    const likeCount = feedbackCounts[0]?.likeCount || 0;
                    const unlikeCount = feedbackCounts[0]?.unlikeCount || 0;
                    const pendingCount = feedbackCounts[0]?.pendingCount || 0;
                    dbg('✅ Found', likeCount, 'likes,', unlikeCount, 'unlikes, and', pendingCount, 'pending for question', question.QuestionsAnswersID);
                    
                    return {
                        ...question,
                        keywords: keywords || [],
                        likeCount: likeCount,
                        unlikeCount: unlikeCount,
                        pendingCount: pendingCount
                    };
                } catch (keywordError) {
                    console.error('⚠️ Error fetching keywords/feedback for question', question.QuestionsAnswersID, ':', keywordError && (keywordError.message || keywordError));
                    // Return question without keywords if there's an error
                    return {
                        ...question,
                        keywords: [],
                        likeCount: 0,
                        unlikeCount: 0,
                        pendingCount: 0
                    };
                }
            })
        );

        dbg('✅ Sending response with', questionsWithKeywords.length, 'questions');
        res.status(200).json(questionsWithKeywords);
    } catch (error) {
        console.error('❌ Error fetching QuestionsAnswers:', error && (error.message || error));
        res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error', 
            error: error.message,
            sqlMessage: error.sqlMessage 
        });
    } finally {
        if (connection) {
            dbg('🔄 Releasing connection');
            connection.release();
        }
    }
};

module.exports = getQuestionsAnswersService;
