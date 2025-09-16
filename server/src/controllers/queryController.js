// src/controllers/queryController.js
import openai from "../utils/openaiClient.js";
import { getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";

export const runSqlQuery = async (req, res) => {
  try {
    const { query } = req.body;
    const dbPath = getDb();

    if (!dbPath) {
      return res.status(400).json({ error: "No database uploaded yet." });
    }
    if (!query?.trim()) {
      return res.status(400).json({ error: "No SQL query provided." });
    }

    // ✅ Load schema from uploaded file
    const schema = await fileHandler(dbPath);

    // ✅ Ask OpenAI to “execute” query on schema
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a SQL execution engine. 
The user will give you:
1) A database schema in JSON.
2) An SQL query.
You must return only JSON rows that would result from running the query on that schema. 
Use realistic sample data if needed.`
        },
        {
          role: "user",
          content: `Schema: ${JSON.stringify(schema, null, 2)}\n\nQuery: ${query}`
        }
      ],
      response_format: { type: "json_object" }
    });

    // ✅ Parse JSON safely
    let rows = [];
    try {
      const raw = completion.choices[0].message.content;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        rows = parsed;
      } else if (parsed.rows && Array.isArray(parsed.rows)) {
        rows = parsed.rows;
      }
    } catch (err) {
      console.error("Failed to parse OpenAI response:", err.message);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    res.json({ rows });
  } catch (err) {
    console.error("Run query error:", err);
    res.status(500).json({ error: err.message });
  }
};
