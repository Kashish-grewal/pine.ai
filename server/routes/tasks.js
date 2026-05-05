const express = require('express');
const router  = express.Router();
const { pool } = require('../db/db');
const { protect } = require('../middleware/auth');

// ================================================================
// PATCH /api/v1/tasks/:id
// ================================================================
// Mark task as completed/incomplete
// ================================================================
router.patch('/:id', protect, async (req, res, next) => {
  try {
    const { is_completed } = req.body;
    await pool.query(
      `UPDATE tasks SET is_completed = $1, updated_at = NOW()
       WHERE task_id = $2 AND user_id = $3`,
      [is_completed, req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
