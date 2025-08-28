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
    const systemPrompt = `
You are an SQL query generator.
Input will contain:
1) A database schema in JSON (map of {tableName: [columns...]})
2) A natural-language user request.

Your task: return exactly one SQL query that satisfies the request using only tables/columns that exist in the schema.

Rules:
- Output only the SQL query (no Markdown, no code fences, no comments, no prose).
- Do not execute anything—just write the query.
- Prefer ANSI-style SQL compatible with common engines; avoid vendor-specific features.
- Use parameter placeholders for user-supplied values (e.g., :p1, :p2, …). Do not inline literal values from the prompt.
- Handle synonyms and variants in the request (e.g., client ↔ customer, user ↔ account, order ↔ purchase, product ↔ item, vendor ↔ supplier, employee ↔ staff, id ↔ uid, created date ↔ created_at, etc.). Map them to the closest matching table/column names in the schema. Use singular/plural normalization and common abbreviations.
- If joins are needed, infer likely keys by name (e.g., users.uid ↔ orders.uid) only when both columns exist.
- If the request implies time filters (e.g., “today”), use portable expressions like CURRENT_DATE/CURRENT_TIMESTAMP where possible, otherwise use placeholders (e.g., :start_date, :end_date).
- If aggregation, sorting, limiting, or pagination is implied, include GROUP BY, ORDER BY, LIMIT accordingly.
- Never invent tables or columns not present in the schema. Use the closest valid alternatives from the schema.

Produce one best-effort SQL statement that follows these rules. Output only the SQL text.
`;


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
