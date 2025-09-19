// src/services/chatService.js
import openai from "../utils/openaiClient.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import { generateSqlWithAI } from "./generateSqlWithAI.js";
import { makeFile, makeJsonFile } from "./dbFileService.js"; // ✅ NEW

export const chatFlowWithAssistant = async (message, existingThreadId = null) => {
  if (!message?.trim()) throw new Error("Message is empty");

  // Reuse thread if exists
  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await openai.beta.threads.create();
    if (!thread?.id) throw new Error("Failed to create thread");
    console.log("Thread created:", thread.id);
    threadId = thread.id;
  } else {
    console.log("Reusing thread:", threadId);
  }

  // ---------- simple intent checks ----------
  const looksLikeSchema = /Tables?:/i.test(message) && /-\s*\w+/.test(message);
  const asksForDbFile = /\b(build|create|generate|make|give)\b.*\b(database|db|file)\b/i.test(message);
  
  // format hints
 const wantsJson = /\bjson\b|\bjson\s*file\b|\bjson\s*format\b/i.test(message);
 const wantsSqlite = /\b(sqlite|\.db)\b/i.test(message);

 


  // ---------- fast path: user asked for a DB file from a schema ----------
  if (asksForDbFile && looksLikeSchema) {
    console.log("[AI DDL] Quick intent hit");
     const sqlRaw = await generateSqlWithAI(message);
  const sql = wantsSqlite ? sqlRaw : normalizeToMySQL(sqlRaw);


    // JSON export
    if (wantsJson) { // ✅ NEW
      const { id, filename } = makeJsonFile({ sql, filename: "database" });
      return {
        aiText: `Your JSON file is ready. Click to download **${filename}**.`,
        threadId, 
        download: { url: `/api/db/download/${id}`, filename },
      };
    }

    // SQLite .db export
    if (wantsSqlite) { // ✅ NEW
      const { id, filename } = makeFile({
        sql,
        format: "db", // alias for sqlite
        filename: "database",
      });
      return {
        aiText: `Your SQLite DB is ready. Click to download **${filename}**.`,
        threadId, // 🔧 CHANGED
        download: { url: `/api/db/download/${id}`, filename },
      };
    }

    // default: .sql
    const { id, filename } = makeFile({
      sql,
      format: "sql",
      filename: "database",
    });

    return {
      aiText: `Your SQL file is ready. Click to download **${filename}**.`,
      threadId, // 🔧 CHANGED
      download: { url: `/api/db/download/${id}`, filename },
    };
  }

  //to make sure the generated sql actually runs in sql app ..
  function normalizeToMySQL(sql) {
  if (!sql) return sql;

  // Drop SQLite-only pragma
  sql = sql.replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*/gim, "");

  // Replace "Identifiers" -> Identifiers
  sql = sql.replace(/"([A-Za-z_][\w]*)"/g, "$1");


  // Ensure semicolons at end of CREATE TABLE blocks
  sql = sql.replace(/(\)\s*)(?!;)/g, "$1");

  return sql.trim();
}


  /* ----------------------------------------------------------- */
  // If a DB is set, reload schema to provide context
  let schemaPart = "";
  const dbPath = getDb();
  if (dbPath) {
    try {
      const schema = await fileHandler(dbPath);
      schemaPart = `Schema: ${JSON.stringify(schema, null, 2)}\n\n`;
    } catch (e) {
      console.warn("Failed to load schema for context:", e.message);
    }
  }

  // Add user message to OpenAI (with schema context if available)
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: `${schemaPart}${message}`,
  });

  // Save user message to DB
  try {
    await saveMessageByThreadId({
      threadId,
      sender: "user",
      text: message,
      title: message.slice(0, 60),
    });
  } catch (e) {
    console.warn("Failed to save user message:", e.message);
  }

  // Run the assistant
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: process.env.SQL_ASSISTANT_ID,
  });
  if (!run?.id) throw new Error("Failed to create run");
  console.log("Run created:", run.id);

  // Poll until run completes (for openai@5.16.0)
  let runStatus;
  let attempts = 0;
  const maxAttempts = 30;

  do {
    runStatus = await openai.beta.threads.runs.retrieve(run.id, {
      thread_id: threadId,
    });
    console.log("Run status:", runStatus.status);

    if (runStatus.status === "in_progress" || runStatus.status === "queued") {
      await new Promise((r) => setTimeout(r, 1000));
      attempts++;
    }
  } while (
    (runStatus.status === "in_progress" || runStatus.status === "queued") &&
    attempts < maxAttempts
  );

  if (runStatus.status !== "completed") {
    throw new Error(`Run failed with status: ${runStatus.status}`);
  }

  // Get assistant reply
  const messages = await openai.beta.threads.messages.list(threadId);
  const lastAssistantMsg = messages.data.find((msg) => msg.role === "assistant");
  const lastMsg =
    lastAssistantMsg?.content?.[0]?.text?.value ||
    messages.data[0]?.content?.[0]?.text?.value ||
    "";

  // Save assistant reply to DB
  try {
    await saveMessageByThreadId({
      threadId,
      sender: "bot",
      text: lastMsg,
    });
  } catch (e) {
    console.warn("Failed to save bot message:", e.message);
  }

  return { aiText: lastMsg.trim(), threadId };
};
