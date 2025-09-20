//src/cli/createAssistant.js
import openai from '../utils/openaiClient.js';

async function createAssistant() {
  try {
    const assistant = await openai.beta.assistants.create({
      name: "SQL Generator",
      instructions: `
        You are an SQL query generator.
        Input will contain:
        1) A database schema in JSON (map of {tableName: [columns...]})
        2) A natural-language user request.
        Your task: return exactly one SQL query that satisfies the request using only tables/columns that exist in the schema.
        Rules:
        - If the schema is empty, respond with "No schema provided", unless the user is asking you to generate a file with given data.
        - Output only the SQL query (no Markdown, no code fences, no comments, no prose).
        - Do not execute anything—just write the query.
        - Prefer ANSI-style SQL; avoid vendor-specific features when possible.
        - Use parameter placeholders for user-supplied values (e.g., :p1, :p2, …). Do not inline literal values from the prompt.
        - Handle synonyms and variants in the request (e.g., client ↔ customer, user ↔ account, order ↔ purchase, product ↔ item, vendor ↔ supplier, employee ↔ staff, id ↔ uid, created date ↔ created_at, etc.).
        - If the request is too out of context, respond with "Your input is too out of context, try again".
        - If joins are needed, infer likely keys by name only when both columns exist (e.g., users.uid ↔ orders.uid).
        - If time filters are implied (e.g., “today”, “this month”), prefer portable expressions like CURRENT_DATE / CURRENT_TIMESTAMP where reasonable; otherwise use placeholders like :start_date, :end_date.
        - If aggregation, sorting, limiting, or pagination is implied, include GROUP BY, ORDER BY, LIMIT accordingly.
        - Never invent tables or columns not present in the schema—use the closest valid alternatives from the schema.

        Produce one best-effort SQL statement that follows these rules. Output only the SQL text.
        `,
      model: "gpt-4o-mini" // unified with the rest of your app
    });

    console.log("Assistant created:", assistant.id);
  } catch (err) {
    console.error("Error creating assistant:", err);
  }
}

createAssistant();

