// server/src/services/generateSqlWithAI.js
import openai from "../utils/openaiClient.js";

const strip = (s = "") => s.replace(/```sql|```/gi, "").trim();

export async function generateSqlWithAI(schemaText) {
  if (!schemaText?.trim()) throw new Error("schemaText is empty");

  const model = process.env.SQL_DDL_MODEL || "gpt-4.1-mini";
  const system = [
    "You are a SQL DDL generator.",
    "Return ONLY raw SQLite SQL. No Markdown, no commentary.",
    "Start with: PRAGMA foreign_keys = ON;",
    'For each table: CREATE TABLE IF NOT EXISTS "TableName" (...);',
    'If a table has no explicit id, add: "id" INTEGER PRIMARY KEY',
    "Infer types: *_id→INTEGER, date/time→TEXT, total/amount/price/score→REAL, else TEXT.",
    "Add FOREIGN KEY for *_id columns referencing the singularized table name's id.",
  ].join("\n");

  let raw = "";

  // v4-style client
  if (openai.chat?.completions?.create) {
    const r = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: schemaText },
      ],
    });
    raw = r?.choices?.[0]?.message?.content || "";
  }
  // v5-style client (Responses API)
  else if (openai.responses?.create) {
    const r = await openai.responses.create({
      model,
      input: `${system}\n\nUser schema:\n${schemaText}\n\nReturn ONLY raw SQL.`,
      temperature: 0,
      max_output_tokens: 1200,
    });
    // v5 helpers
    raw =
      r.output_text ||
      r?.output?.[0]?.content?.[0]?.text ||
      r?.choices?.[0]?.message?.content ||
      "";
  } else {
    throw new Error(
      "OpenAI client does not expose chat.completions or responses."
    );
  }

  const sql = strip(raw);
  if (!/create\s+table/i.test(sql)) {
    // Log a preview so you can see what the model returned
    console.error("[generateSqlWithAI] Bad SQL preview:", sql.slice(0, 200));
    throw new Error("Model did not return CREATE TABLE statements.");
  }
  return sql;
}
