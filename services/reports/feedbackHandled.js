/**
 * Service to mark feedback as handled (for unlike feedbacks)
 * @param {object} pool - MySQL connection pool
 * @returns {function} - Express middleware (req, res)
 */
const markFeedbackHandledService = (pool) => async (req, res) => {
    try {
        const { feedbackId } = req.params;
        
        if (!feedbackId) {
            return res.status(400).json({ 
                success: false, 
                message: 'FeedbackID is required' 
            });
        }

        // Debug: fetch existing feedback row to help diagnose 404 cases
        let existingRows = [];
        try {
            const qr = await pool.query(
                `SELECT FeedbackID, FeedbackValue, HandledAt FROM Feedbacks WHERE FeedbackID = ? LIMIT 1`,
                [feedbackId]
            );
            existingRows = qr && qr[0] ? qr[0] : [];
            if (existingRows && existingRows.length > 0) {
                console.log(`🔎 markFeedbackHandled: found feedback row for id=${feedbackId}:`, existingRows[0]);
            } else {
                console.log(`🔎 markFeedbackHandled: no feedback row found for id=${feedbackId}`);
            }
        } catch (e) {
            console.error('🔎 markFeedbackHandled: failed to query existing feedback row:', e && e.message);
        }

        // If the row exists but is already handled or not of the expected FeedbackValue, return 409 Conflict with a helpful message
        if (existingRows && existingRows.length > 0) {
            const row = existingRows[0];
            if (row.HandledAt) {
                return res.status(409).json({ success: false, message: 'Feedback already handled' });
            }
            if (row.FeedbackValue != null && Number(row.FeedbackValue) !== 0) {
                return res.status(409).json({ success: false, message: 'Feedback cannot be marked as handled (unsupported feedback type)' });
            }
        }

        // Mark as handled with current timestamp
        const [result] = await pool.query(
            `UPDATE Feedbacks 
             SET HandledAt = NOW() 
             WHERE FeedbackID = ? AND FeedbackValue = 0`,
            [feedbackId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Feedback not found or already handled' 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Feedback marked as handled',
            feedbackId: feedbackId
        });
    } catch (error) {
        console.error('❌ Error marking feedback as handled:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * Service to get handled feedbacks (for cleanup report)
 * @param {object} pool - MySQL connection pool
 * @returns {function} - Express middleware (req, res)
 */
const getHandledFeedbacksService = (pool) => async (req, res) => {
    try {
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
                qa.QuestionsAnswersID,
                DATEDIFF(DATE_ADD(f.HandledAt, INTERVAL 30 DAY), NOW()) as DaysUntilDelete
             FROM Feedbacks f
             LEFT JOIN ChatLogHasAnswers c ON f.ChatLogID = c.ChatLogID
             LEFT JOIN QuestionsAnswers qa ON c.QuestionsAnswersID = qa.QuestionsAnswersID
             WHERE f.HandledAt IS NOT NULL
             ORDER BY f.HandledAt DESC`
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('❌ Error fetching handled feedbacks:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * Service to cleanup handled feedbacks older than 30 days
 * Also deletes corresponding ChatLogHasAnswers records
 * @param {object} pool - MySQL connection pool
 * @returns {function} - Express middleware or direct call
 */
const cleanupHandledFeedbacksService = (pool) => async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get ChatLogIDs of feedbacks to be deleted
        const [feedbacksToDelete] = await connection.query(
            `SELECT ChatLogID FROM Feedbacks 
             WHERE HandledAt IS NOT NULL 
             AND HandledAt < DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );
        
        const chatLogIds = feedbacksToDelete.map(f => f.ChatLogID).filter(Boolean);

        // 2. Delete feedbacks
        const [feedbackResult] = await connection.query(
            `DELETE FROM Feedbacks 
             WHERE HandledAt IS NOT NULL 
             AND HandledAt < DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );

        // 3. Delete corresponding ChatLogHasAnswers
        let chatLogDeletedCount = 0;
        if (chatLogIds.length > 0) {
            const [chatLogResult] = await connection.query(
                `DELETE FROM ChatLogHasAnswers WHERE ChatLogID IN (?)`,
                [chatLogIds]
            );
            chatLogDeletedCount = chatLogResult.affectedRows || 0;
        }

        await connection.commit();

        const message = `Cleaned up ${feedbackResult.affectedRows} handled feedbacks and ${chatLogDeletedCount} chat logs older than 30 days`;
        console.log(`🧹 ${message}`);

        if (res) {
            res.status(200).json({ 
                success: true, 
                message,
                deletedCount: feedbackResult.affectedRows,
                chatLogsDeleted: chatLogDeletedCount
            });
        }
        
        return feedbackResult.affectedRows;
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error cleaning up handled feedbacks:', error);
        if (res) {
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
        throw error;
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Service to restore a handled feedback back to unhandled (set HandledAt = NULL)
 * @param {object} pool - MySQL connection pool
 * @returns {function} - Express middleware (req, res)
 */
const unhandleFeedbackService = (pool) => async (req, res) => {
    try {
        const { feedbackId } = req.params;
        if (!feedbackId) {
            return res.status(400).json({ success: false, message: 'FeedbackID is required' });
        }

        const [result] = await pool.query(
            `UPDATE Feedbacks
             SET HandledAt = NULL
             WHERE FeedbackID = ?`,
            [feedbackId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Feedback not found' });
        }

        res.status(200).json({ success: true, message: 'Feedback restored to unhandled', feedbackId });
    } catch (error) {
        console.error('❌ Error restoring feedback:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = {
    markFeedbackHandledService,
    getHandledFeedbacksService,
    cleanupHandledFeedbacksService,
    unhandleFeedbackService
};
