const express = require('express');
const router = express.Router();

const { analyzeColumns } = require('../controllers/ai.controller');

// JSON body: { columns: { table: [cols...] }, note?: string }
router.post('/analyze-columns', analyzeColumns);

module.exports = router;
