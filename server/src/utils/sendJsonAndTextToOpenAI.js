// server_src/utils/sendJsonAndTextToOpenAI.js
const openai = require('./openaiClient');

function safeStringify(obj, max = 50_000) {
  try {
    const s = JSON.stringify(obj, null, 2);
    return s.length > max ? s.slice(0, max) + '\n...<truncated>...' : s;
  } catch {
    return String(obj);
  }
}

function clip(text, max = 50_000) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '\n...<truncated>...' : text;
}

// Default, strict system prompt for “schema + NL → SQL”
const DEFAULT_SQL_SYSTEM_PROMPT = `
You are an SQL query generator.
Input will contain:
1) A database schema in JSON (map of {tableName: [columns...]})
2) A natural-language user request.

Your task: return exactly one SQL query that satisfies the request using only tables/columns that exist in the schema.

Rules:
- Output only the SQL query (no Markdown, no code fences, no comments, no prose).
- Do not execute anything—just write the query.
- Prefer ANSI-style SQL; avoid vendor-specific features when possible.
- Use parameter placeholders for user-supplied values (e.g., :p1, :p2, …). Do not inline literal values from the prompt.
- Handle synonyms and variants in the request (e.g., client ↔ customer, user ↔ account, order ↔ purchase, product ↔ item, vendor ↔ supplier, employee ↔ staff, id ↔ uid, created date ↔ created_at, etc.). Map them to the closest matching table/column names in the schema; use singular/plural normalization and common abbreviations.
- If joins are needed, infer likely keys by name only when both columns exist (e.g., users.uid ↔ orders.uid).
- If time filters are implied (e.g., “today”, “this month”), prefer portable expressions like CURRENT_DATE / CURRENT_TIMESTAMP where reasonable; otherwise use placeholders like :start_date, :end_date.
- If aggregation, sorting, limiting, or pagination is implied, include GROUP BY, ORDER BY, LIMIT accordingly.
- Never invent tables or columns not present in the schema—use the closest valid alternatives from the schema.

Produce one best-effort SQL statement that follows these rules. Output only the SQL text.
`.trim();

/**
 * Sends a JSON schema + user text to OpenAI and returns the model's raw text.
 * @param {{
 *   jsonObject: any,             // DB schema as an object (e.g., {table: [cols...]})
 *   text?: string,               // User's natural-language request
 *   systemPrompt?: string,       // Optional override of the system prompt
 *   model?: string,              // OpenAI model (default gpt-4o-mini)
 *   temperature?: number,        // Defaults to 0 for deterministic SQL
 *   max_output_tokens?: number   // Optional cap; default 800
 * }} p
 */
async function sendJsonAndTextToOpenAI({
  jsonObject,
  text = '',
  systemPrompt = DEFAULT_SQL_SYSTEM_PROMPT,
  model = 'gpt-4o-mini',
  temperature = 0,
  max_output_tokens = 800
}) {
  // Build a clear, 2-part user message the model can parse reliably
  const userContent = [
    'SCHEMA_JSON:',
    safeStringify(jsonObject),
    '',
    'USER_REQUEST:',
    clip(text)
  ].join('\n');

  const response = await openai.responses.create({
    model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature,
    max_output_tokens
  });

  // Robust extraction across SDK shapes
  const out =
    response.output_text ||
    response.output?.[0]?.content?.[0]?.text ||
    response.choices?.[0]?.message?.content ||
    '';

  // Trim and return (should be SQL only per the prompt)
  return out.trim() || 'SELECT 1;';
}

module.exports = { sendJsonAndTextToOpenAI };
