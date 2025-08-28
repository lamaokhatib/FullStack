const { sendJsonAndTextToOpenAI } = require('../utils/sendJsonAndTextToOpenAI');

/**
 * POST /api/ai/analyze-columns
 * Body: { columns: { [table: string]: string[] }, note?: string }
 * - columns is exactly what your fileHandler.js returns
 */
async function analyzeColumns(req, res) {
  try {
    const { columns, note = '' } = req.body || {};
    const isObject = columns && typeof columns === 'object' && !Array.isArray(columns);

    if (!isObject) {
      return res.status(400).json({ error: '`columns` (object) is required' });
    }

    // Optional: short-circuit if fileHandler returned an error shape
    if (columns.error) {
      return res.status(400).json({ error: `parser error: ${columns.error}` });
    }

    const systemPrompt = `You are a senior database engineer.
Given a schema map of {tableName: [column, ...]}, do the following:
1) List each table with its columns.
2) Infer likely primary keys and foreign keys from names (best effort).
3) Suggest 5 useful SELECT queries (with JOINs if appropriate).
4) Suggest 3 indexes that would likely help performance.
Keep output concise and structured.`;//TODO: change into something more universal for all ai prompts like only reply with an sql query

    const result = await sendJsonAndTextToOpenAI({
      jsonObject: { schemaMap: columns },
      text: note ? `Note from user: ${note}` : '',
      systemPrompt
    });

    res.json({ result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'OpenAI call failed' });
  }
}

module.exports = {
  analyzeColumns,
};
