// src/services/chatService.js
import openai from "../utils/openaiClient.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import { makeFile } from "./dbFileService.js";

export const chatFlowWithAssistant = async (message, existingThreadId = null) => {
  if (!message?.trim()) throw new Error("Message is empty");

  /* ---------- QUICK INTENT: "build a db file" from bullet schema ---------- */
  const looksLikeSchema = /Tables?:/i.test(message) && /-\s*\w+/.test(message);
  const asksForDbFile = /\b(build|create|generate|make)\b.*\b(database|db|file)\b/i.test(message);
  if (asksForDbFile && looksLikeSchema) {
    // If makeFile is async, keep the await:
    const { id, filename } = await makeFile({
      schemaText: message,
      format: "sql",
      filename: "database",
    });

    return {
      // 🔧 match frontend which expects result.openai
      openai: `Your SQL file is ready. Click to download **${filename}**.`,
      threadId: existingThreadId ?? null,
      download: { url: `/db/download/${id}`, filename },
    };
  }
  /* ----------------------------------------------------------------------- */

  // Reuse or create thread
  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await openai.beta.threads.create();
    if (!thread?.id) throw new Error("Failed to create thread");
    threadId = thread.id;
  }

  // If a DB is set, load schema for context
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

  // Add user message to OpenAI
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: `${schemaPart}${message}`,
  });

  // Save user message
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

  // Poll until run completes
  let runStatus;
  let attempts = 0;
  const maxAttempts = 30;
  do {
    // 🔧 correct param order: (threadId, runId)
    runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
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

  // Get assistant’s reply (prefer newest assistant message)
  const msgs = await openai.beta.threads.messages.list(threadId);
  // messages.list is usually newest-first; this finds the first assistant msg
  const assistantMsg = msgs.data.find((m) => m.role === "assistant");
  const lastMsg =
    assistantMsg?.content?.[0]?.text?.value ||
    msgs.data[0]?.content?.[0]?.text?.value ||
    "";

  // Save assistant reply
  try {
    await saveMessageByThreadId({
      threadId,
      sender: "bot",
      text: lastMsg,
    });
  } catch (e) {
    console.warn("Failed to save bot message:", e.message);
  }

  // 🔧 match frontend contract: return "openai", not "aiText"
  return { openai: lastMsg.trim(), threadId };
};
