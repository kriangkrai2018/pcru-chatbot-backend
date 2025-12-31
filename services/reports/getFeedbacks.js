    /**
     * Service to get all feedbacks for the logged-in officer.
     * Only returns feedbacks that haven't been handled yet.
     * @param {object} pool - MySQL connection pool
     * @returns {function} - Express middleware (req, res)
     */
    const getFeedbacksService = (pool) => async (req, res) => {
        try {
            const order = req.query && String(req.query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            // Only return feedbacks that are still unhandled and are related to questions/answers authored by the logged-in officer
            const officerId = req.user && req.user.userId ? req.user.userId : null;
            if (!officerId) {
                return res.status(401).json({ success: false, message: 'Unauthorized: officer id not found in token' });
            }

            const [rows] = await pool.query(
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
                INNER JOIN ChatLogHasAnswers c ON f.ChatLogID = c.ChatLogID
                INNER JOIN QuestionsAnswers qa ON c.QuestionsAnswersID = qa.QuestionsAnswersID
                WHERE f.HandledAt IS NULL AND qa.OfficerID = ?
                ORDER BY f.Timestamp ${order}`,
                [officerId]
            );
            console.log('📊 getFeedbacks: returning', rows.length, 'feedbacks');
            res.status(200).json(rows);
        } catch (error) {
            console.error('❌ Error fetching feedbacks:', error);
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    };

    module.exports = getFeedbacksService;
