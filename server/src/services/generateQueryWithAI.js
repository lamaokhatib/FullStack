// server/src/services/generateQueryWithAI.js
import openai from "../utils/openaiClient.js";
import { getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";

const stripFences = (s = "") => s.replace(/```sql|```/gi, "").trim();

/**
 * Turn a natural-language question into VALID **SQLite** SELECT/CTE SQL.
 * Returns raw SQL string (no Markdown).
 */
export async function generateQueryWithAI(question) {
  if (!question?.trim()) throw new Error("question is empty");

  // Try to include current DB schema to ground the model
  let schemaText = "";
  const dbPath = getDb();
  if (dbPath) {
    try {
      const schema = await fileHandler(dbPath); // your existing introspector
      schemaText =
        "SQLite schema (tables & columns):\n" +
        JSON.stringify(schema, null, 2) +
        "\n\n";
    } catch (e) {
      console.warn("[generateQueryWithAI] Could not load schema:", e.message);
    }
  }

  const model = process.env.SQL_QUERY_MODEL || "gpt-4o-mini";
  const system = [
    "You write SQLite SELECT queries.",
    "Output MUST be raw SQL ONLY. No Markdown, no code fences, no commentary.",
    "Rules:",
    "- Use ONLY SQLite syntax (no schema prefixes like public., no :: casts).",
    "- Prefer exact table/column names from the provided schema, if present.",
    "- Return ONLY a single query starting with WITH or SELECT.",
    "- If the result could be large, add LIMIT 50.",
    "- Never write DDL or DML here; only read queries.",
  ].join("\n");

  let raw = "";

  // v4-style client
  if (openai.chat?.completions?.create) {
    const r = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: schemaText + "Question:\n" + question,
        },
      ],
    });
    raw = r?.choices?.[0]?.message?.content || "";
  }
  // v5-style client (Responses API)
  else if (openai.responses?.create) {
    const r = await openai.responses.create({
      model,
      temperature: 0,
      max_output_tokens: 800,
      input:
        system +
        "\n\n" +
        schemaText +
        "Question:\n" +
        question +
        "\n\nReturn ONLY raw SQL.",
    });
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

  // Clean + validate
  let sql = stripFences(raw)
    .replace(/\b[a-z_]+\./gi, "") // drop schema qualifiers like public.users
    .replace(/`/g, '"') // normalize accidental backticks
    .trim();

  if (!/^\s*(with|select)\b/i.test(sql)) {
    console.error("[generateQueryWithAI] Bad SQL preview:", sql.slice(0, 160));
    throw new Error("Model did not return a SELECT/CTE statement.");
  }

  return sql;
}
