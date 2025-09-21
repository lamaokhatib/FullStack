// server/src/controllers/quickResultController.js

import fs from "fs";
import os from "os";
import path from "path";

import { processUploadAndAnalyze } from "../services/uploadService.js";
import { runSqlQuery } from "./queryController.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb, setDb } from "../config/dbState.js";
import openai from "../utils/openaiClient.js";

// Build a lightweight schema from real SQLite (if already a .db)
async function buildSqliteSchema(dbPath) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const schema = {};
    for (const { name } of tables) {
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
      schema[name] = cols.map((c) => c.name);
    }
    return schema;
  } finally {
    db.close();
  }
}

function stripCodeFences(s = "") {
  return (s || "")
    .replace(/```(?:sql)?/gi, "")
    .replace(/```/g, "")
    .trim()
    .replace(/^["'`](.*)["'`]$/s, "$1");
}

// Generate a quick result from prompt (+ optional file)
export const quickResult = async (req, res) => {
  try {
    const prompt = req.body?.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    const userId = req.body?.userId ?? null;
    let threadId = req.body?.threadId || null;
    let fileMsg = null;
    let savedUser = null;

    if (req.file) {
      const result = await processUploadAndAnalyze(
        req.file.path,
        prompt,
        threadId,
        true,    // silent
        userId
      );
      threadId = result.threadId;
      fileMsg = result.fileMsg;
      savedUser = result.userMessage || null;

      setDb(req.file.path); // executor will ingest as needed
    } else {
      // new thread for quick result
      const thread = await openai.beta.threads.create();
      threadId = thread.id;

      savedUser = await saveMessageByThreadId({
        threadId,
        userId,
        sender: "user",
        text: prompt,
        title: prompt.slice(0, 60),
      });
    }

    let dbPath = getDb();
    if (!dbPath || !fs.existsSync(dbPath)) {
      return res.status(400).json({
        error: "No database loaded. Upload a .db/.sqlite/.sql/.json/.csv file before using Quick Result.",
      });
    }

    // Optional schema hint if already SQLite
    let schema = {};
    try { if (dbPath.endsWith(".db") || dbPath.endsWith(".sqlite")) schema = await buildSqliteSchema(dbPath); } catch {}

    // Ask AI for a runnable SQLite SELECT/WITH query (no code fences)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Generate only a valid SQLite SELECT or WITH query that runs on the provided schema. " +
            "If the data originally comes from PostgreSQL schemas like public.users, rewrite table names to the ingested form (e.g., public_users). " +
            "No DDL/DML/PRAGMA. No comments. Return only the raw SQL.",
        },
        {
          role: "user",
          content: `Schema (may be partial): ${JSON.stringify(schema)}\n\nRequest: ${prompt}`,
        },
      ],
    });

    let sql = stripCodeFences(completion.choices?.[0]?.message?.content || "");
    if (!sql) return res.status(400).json({ error: "Model returned empty SQL." });

    // Run SQL through the executor (which ingests .sql/.json/.csv → SQLite and repairs if needed)
    let queryResult;
    await runSqlQuery(
      {
        body: {
          query: sql,
          threadId,
          messageId: savedUser?.message?._id ?? null,
          dbFileMessageId: fileMsg ? fileMsg._id : null,
        },
      },
      {
        json: (data) => { queryResult = data; return data; },
        status: (code) => ({ json: (data) => { queryResult = { code, ...data }; return data; } }),
      }
    );

    if (queryResult?.error) {
      return res.status(400).json({ error: queryResult.error });
    }
    if (!queryResult?.rows) throw new Error("No rows returned");

    await saveMessageByThreadId({
      threadId,
      userId,
      sender: "bot",
      rows: queryResult.rows,
      type: "result",
      dbFileMessageId: fileMsg ? fileMsg._id : null,
    });

    return res.json({ rows: queryResult.rows, threadId });
  } catch (err) {
    console.error("Quick result error:", err);
    res.status(500).json({ error: err.message });
  }
};
