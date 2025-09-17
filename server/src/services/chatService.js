// src/services/chatService.js
import openai from "../utils/openaiClient.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import { generateSqlWithAI } from "./generateSqlWithAI.js";
import { makeFile } from "./dbFileService.js"; // ← NEW: create file + keep a /download/:id handle

export const chatFlowWithAssistant = async (
  message,
  existingThreadId = null
) => {
  if (!message?.trim()) throw new Error("Message is empty");

  const looksLikeSchema = /Tables?:/i.test(message) && /-\s*\w+/.test(message);
  const asksForDbFile =
    /\b(build|create|generate|make)\b.*\b(database|db|file)\b/i.test(message);

  if (asksForDbFile && looksLikeSchema) {
    console.log("[AI DDL] Quick intent hit");
    const sql = await generateSqlWithAI(message);

    // choose which file to deliver
    const { id, filename } = makeFile({
      sql,
      format: "sql", // or "sqlite" if you want a .sqlite DB
      filename: "database",
    });

    return {
      openai: `Your SQL file is ready. Click to download **${filename}**.`,
      threadId: existingThreadId ?? null,
      download: { url: `/api/db/download/${id}`, filename },
    };
  }

  /* ----------------------------------------------------------- */

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

  // 4. Get assistant’s reply
  const msgs = await openai.beta.threads.messages.list(threadId);
  const lastAssistantMsg = msgs.data.find((m) => m.role === "assistant");
  const lastMsg =
    lastAssistantMsg?.content?.[0]?.text?.value ||
    msgs.data[0]?.content?.[0]?.text?.value ||
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

  return { openai: lastMsg.trim(), threadId };
};
