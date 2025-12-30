const express = require('express');

/**
 * Wrapper router to expose NegativeKeywords CRUD under /api/negative-keywords
 * This simply re-uses the existing CRUD routes implemented in
 * `routes/negativeKeywordsCrud.js` (which is factory-based and accepts pool)
 */

module.exports = function(pool) {
  const router = express.Router();

  // Re-use existing CRUD routes
  const negativeCrud = require('./negativeKeywordsCrud')(pool);
  router.use('/', negativeCrud);

  return router;
};
