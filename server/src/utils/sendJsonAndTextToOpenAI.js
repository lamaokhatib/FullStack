import openai from './openaiClient.js';

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
- Handle synonyms and variants in the request (e.g., client ↔ customer, user ↔ account, order ↔ purchase, product ↔ item, vendor ↔ supplier, employee ↔ staff, id ↔ uid, created date ↔ created_at, etc.).
- If joins are needed, infer likely keys by name only when both columns exist (e.g., users.uid ↔ orders.uid).
- If time filters are implied (e.g., “today”, “this month”), prefer portable expressions like CURRENT_DATE / CURRENT_TIMESTAMP where reasonable; otherwise use placeholders like :start_date, :end_date.
- If aggregation, sorting, limiting, or pagination is implied, include GROUP BY, ORDER BY, LIMIT accordingly.
- Never invent tables or columns not present in the schema—use the closest valid alternatives from the schema.

Produce one best-effort SQL statement that follows these rules. Output only the SQL text.
`.trim();

/**
 * Sends a JSON schema + user text to OpenAI and returns the model's raw text.
 */
export async function sendJsonAndTextToOpenAI({
  jsonObject,
  text = '',
  systemPrompt = DEFAULT_SQL_SYSTEM_PROMPT,
  model = 'gpt-4o-mini',
  temperature = 0,
  max_output_tokens = 800
}) {
  const userContent = [
    'SCHEMA_JSON:',
    safeStringify(jsonObject),
    '',
    'USER_REQUEST:',
    clip(text)
  ].join('\n');

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature,
    max_tokens: max_output_tokens
  });

  return response.choices?.[0]?.message?.content?.trim() || 'SELECT 1;';
}
