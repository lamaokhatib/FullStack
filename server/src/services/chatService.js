// src/services/chatService.js
import openai from "../utils/openaiClient.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import Message from "../schemas/messageSchema.js";
import { generateSqlWithAI } from "./generateSqlWithAI.js";
import { makeFile } from "./dbFileService.js";

export const chatFlowWithAssistant = async (
  message,
  existingThreadId = null
) => {
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
  const lastAssistantMsg = messages.data.find(
    (msg) => msg.role === "assistant"
  );
  const lastMsg =
    lastAssistantMsg?.content?.[0]?.text?.value ||
    messages.data[0]?.content?.[0]?.text?.value ||
    "";

  // Find the most recent file message in this thread (if any)
  let fileMessageId = null;
  try {
    const lastFileMsg = await Message.findOne({
      threadId,
      "file.name": { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .select("_id");
    fileMessageId = lastFileMsg ? lastFileMsg._id : null;
    console.log("Found file message for dbFileMessageId:", fileMessageId);
  } catch (e) {
    console.warn("Could not find file message for dbFileMessageId:", e.message);
  }

  // If no file found, try to find any file in the entire thread history
  if (!fileMessageId) {
    try {
      const anyFileMsg = await Message.findOne({
        threadId,
        "file.name": { $exists: true, $ne: null },
      }).select("_id");
      fileMessageId = anyFileMsg ? anyFileMsg._id : null;
      console.log("Found any file message in thread:", fileMessageId);
    } catch (e) {
      console.warn("Could not find any file message in thread:", e.message);
    }
  }

  // Save assistant reply to DB, linking to the latest file if available
  try {
    await saveMessageByThreadId({
      threadId,
      sender: "bot",
      text: lastMsg,
      dbFileMessageId: fileMessageId, // This links the bot response to the file
    });
    console.log("Saved bot message with dbFileMessageId:", fileMessageId);
  } catch (e) {
    console.warn("Failed to save bot message:", e.message);
  }

  return { aiText: lastMsg.trim(), threadId };
};