import openai from "../utils/openaiClient.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb, setDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import Message from "../schemas/messageSchema.js";
import { generateSqlWithAI } from "./generateSqlWithAI.js";
import { makeFile, makeJsonFile } from "./dbFileService.js";

// NEW: for priming a temp file from Mongo
import fs from "fs";
import os from "os";
import path from "path";

export const chatFlowWithAssistant = async (message, existingThreadId = null, userId = null) => {
  if (!message?.trim()) throw new Error("Message is empty");

  // Reuse thread if exists
  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await openai.beta.threads.create();
    if (!thread?.id) throw new Error("Failed to create thread");
    threadId = thread.id;
  }

  // ---------- simple intent checks ----------
  const looksLikeSchema = /Tables?:/i.test(message) && (/[-\w]+[:\s]+\w+/.test(message));
  const asksForDbFile =
    /\b(build|create|generate|make|give|produce)\b[\s\S]*\b(database|db|file|sqlite|\.db|\.sql)\b/i
      .test(message);
  
  // format hints
  const wantsJson = /\bjson\b|\bjson\s*file\b|\bjson\s*format\b/i.test(message);
  const wantsSqlite = /\b(sqlite|\.db)\b/i.test(message);

  // ---------- fast path: user asked for a DB file from a schema ----------
  if (asksForDbFile && looksLikeSchema) {
    console.log("[AI DDL] Quick intent hit");
    const sqlRaw = await generateSqlWithAI(message);
    const sql = wantsSqlite ? sqlRaw : normalizeToMySQL(sqlRaw);

    try {
      await saveMessageByThreadId({
        threadId,
        sender: "user",
        text: message,
        title: message.slice(0, 60),
      });
    } catch (e) {
      console.warn("Failed to save user message (DDL fast path):", e.message);
    }

    const botTextForDownload = (filename) =>
      `Your ${wantsJson ? "JSON" : wantsSqlite ? "SQLite DB" : "SQL"} file is ready. Click to download **${filename}**.`;

    if (wantsJson) {
      const { id, filename } = makeJsonFile({ sql, filename: "database" });

      try {
        await saveMessageByThreadId({
          threadId,
          sender: "bot",
          text: botTextForDownload(filename),
        });
      } catch (e) {
        console.warn("Failed to save bot message (DDL fast path, json):", e.message);
      }

      return {
        aiText: botTextForDownload(filename),
        threadId, 
        download: { url: `/api/db/download/${id}`, filename },
      };
    }

    if (wantsSqlite) {
      const { id, filename } = makeFile({ sql, format: "db", filename: "database" });
      await saveMessageByThreadId({
        threadId, userId, sender: "bot", text: botTextForDownload(filename)
      });

      try {
        await saveMessageByThreadId({
          threadId,
          sender: "bot",
          text: botTextForDownload(filename),
        });
      } catch (e) {
        console.warn("Failed to save bot message (DDL fast path, sqlite):", e.message);
      }

      return {
        aiText: botTextForDownload(filename),
        threadId,
        download: { url: `/api/db/download/${id}`, filename },
      };
    }

    const { id, filename } = makeFile({
      sql,
      format: "sql",
      filename: "database",
    });

    try {
      await saveMessageByThreadId({
        threadId,
        sender: "bot",
        text: botTextForDownload(filename),
      });
    } catch (e) {
      console.warn("Failed to save bot message (DDL fast path, sql):", e.message);
    }

    return {
      aiText: botTextForDownload(filename),
      threadId, // CHANGED
      download: { url: `/api/db/download/${id}`, filename },
    };
  }

  // to make sure the generated sql actually runs in sql app ..
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
  // PRIMING STEP: if no global DB set, try to restore it from this thread's latest file
  let dbPath = getDb();
  if (!dbPath) {
    try {
      // Find most recent message in this thread that has a file
      const fileMsg = await Message.findOne({
        threadId,
        "file.name": { $exists: true, $ne: null },
        "file.data": { $exists: true },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (fileMsg?.file?.data && fileMsg.file.name) {
        const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${fileMsg.file.name}`);
        fs.writeFileSync(tmpPath, Buffer.from(fileMsg.file.data)); // rebuild temp file from Mongo
        setDb(tmpPath); // set as active DB/file for schema extraction
        dbPath = tmpPath;

        // NOTE: we intentionally do not delete this temp file immediately.
        // runSqlQuery already cleans up temps it creates; for chat context it's fine to leave
        // or you can schedule a delayed cleanup if you prefer:
        // setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 60 * 60 * 1000);
      }
    } catch (err) {
      console.warn("Schema prime from thread failed:", err.message);
    }
  }

  // If a DB/file is set, reload schema to provide context
  let schemaPart = "";
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

  // Save user message (stamps Chat owner if provided)
  await saveMessageByThreadId({
    threadId,
    userId,
    sender: "user",
    text: message,
    title: message.slice(0, 60),
  });

  // Run the assistant
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: process.env.SQL_ASSISTANT_ID,
  });
  if (!run?.id) throw new Error("Failed to create run");

  // Poll until run completes
  let runStatus;
  let attempts = 0;
  const maxAttempts = 30;

  do {
    runStatus = await openai.beta.threads.runs.retrieve(run.id, {
      thread_id: threadId,
    });

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

  // Find the most recent file message in this thread (if any) to link DB context
  let fileMessageId = null;
  try {
    const lastFileMsg = await Message.findOne({
      threadId,
      "file.name": { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .select("_id");
    fileMessageId = lastFileMsg ? lastFileMsg._id : null;
  } catch (e) {
    console.warn("Could not find file message for dbFileMessageId:", e.message);
  }

  // Save assistant reply (no change to Message schema)
  await saveMessageByThreadId({
    threadId,
    userId,
    sender: "bot",
    text: lastMsg,
    dbFileMessageId: fileMessageId,
  });

  return { aiText: lastMsg.trim(), threadId };
};
