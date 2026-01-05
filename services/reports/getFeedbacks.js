    /**
     * Service to get all feedbacks for the logged-in officer.
     * By default, returns feedbacks that haven't been handled yet.
     * Use ?all=true to get ALL feedbacks (including handled).
     * @param {object} pool - MySQL connection pool
     * @returns {function} - Express middleware (req, res)
     */
    const getFeedbacksService = (pool) => async (req, res) => {
        try {
            const order = req.query && String(req.query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            const showAll = req.query && (req.query.all === 'true' || req.query.all === '1');
            // Only return feedbacks that are still unhandled and are related to questions/answers authored by the logged-in officer
            const officerId = req.user && req.user.userId ? req.user.userId : null;
            const userRole = req.user?.role;
            const isAdmin = userRole === 'Super Admin' || userRole === 'Admin';

            if (!officerId) {
                return res.status(401).json({ success: false, message: 'Unauthorized: officer id not found in token' });
            }

            let query = `SELECT 
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
                INNER JOIN ChatLogHasAnswers c ON f.ChatLogID = c.ChatLogID
                INNER JOIN QuestionsAnswers qa ON c.QuestionsAnswersID = qa.QuestionsAnswersID`;
            
            const params = [];
            const conditions = [];

            // Filter by HandledAt unless showAll is true
            if (!showAll) {
                conditions.push('f.HandledAt IS NULL');
            }

            if (!isAdmin) {
                conditions.push('qa.OfficerID = ?');
                params.push(officerId);
            }

            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }

            query += ` ORDER BY f.Timestamp ${order}`;

            const [rows] = await pool.query(query, params);
            console.log('📊 getFeedbacks: returning', rows.length, 'feedbacks (all=' + showAll + ')');
            res.status(200).json(rows);
        } catch (error) {
            console.error('❌ Error fetching feedbacks:', error);
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    };

    module.exports = getFeedbacksService;
