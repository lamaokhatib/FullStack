import openai from "../utils/openaiClient.js";
import fileHandler from "../utils/fileHandler.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import fs from "fs";
import path from "path";

export const processUploadAndAnalyze = async (
  filePath,
  prompt,
  existingThreadId = null,
  silent = false,
  userId = null        // 👈 NEW (optional)
) => {
  if (!filePath) throw new Error("No file uploaded");

  const columns = await fileHandler(filePath);

  // reuse thread if exists
  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await openai.beta.threads.create();
    if (!thread?.id) throw new Error("Failed to create thread (no id in response)");
    threadId = thread.id;
  }

  // Read file data for storage
  const fileBuffer = fs.readFileSync(filePath);
  const fileStats = fs.statSync(filePath);

  // Add schema + prompt to OpenAI thread
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: `Schema: ${JSON.stringify(columns)}\nRequest: ${prompt}`,
  });

  // Save user message to DB with file metadata (stamps Chat owner if provided)
  let fileMsg = null;
  try {
    const saved = await saveMessageByThreadId({
      threadId,
      userId, // 👈 stamp owner on Chat
      sender: "user",
      text: prompt,
      file: {
        name: path.basename(filePath),
        path: filePath,
        size: fileStats.size,
        mimeType: "application/octet-stream",
        data: fileBuffer,
      },
      title: prompt.slice(0, 60),
    });
    fileMsg = saved.message; // capture message with file
  } catch (e) {
    console.warn("Failed to save user message:", e.message);
  }

  if (!silent) {
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: process.env.SQL_ASSISTANT_ID,
    });
    if (!run?.id) throw new Error("Failed to create run (no id in response)");

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

    // Get assistant's reply
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
        userId, // 👈 keep ownership on Chat
        sender: "bot",
        text: lastMsg,
        dbFileMessageId: fileMsg ? fileMsg._id : null, // link to file message
      });
    } catch (e) {
      console.warn("Failed to save bot message:", e.message);
    }

    return { columns, aiText: lastMsg.trim(), threadId, fileMsg };
  } else {
    // ⚡ Silent mode → Skip assistant reply
    return { columns, aiText: "", threadId, fileMsg };
  }
};
