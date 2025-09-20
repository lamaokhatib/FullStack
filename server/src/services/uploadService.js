import openai from "../utils/openaiClient.js";
import fileHandler from "../utils/fileHandler.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import fs from "fs";
import path from "path";

export const processUploadAndAnalyze = async (
  filePath,
  prompt,
  existingThreadId = null,
  silent = false // 👈 new flag
) => {
  if (!filePath) throw new Error("No file uploaded");

  const columns = await fileHandler(filePath);
  console.log("=== processUploadAndAnalyze START ===");
  console.log("Incoming params:", { filePath, prompt, existingThreadId, silent });

  // reuse thread if exists
  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await openai.beta.threads.create();
    console.log("Thread create response:", JSON.stringify(thread, null, 2));
    if (!thread?.id) throw new Error("Failed to create thread (no id in response)");
    threadId = thread.id;
    console.log("Thread created with id:", threadId);
  } else {
    console.log("Reusing existing thread:", threadId);
  }

  // Read file data for storage
  const fileBuffer = fs.readFileSync(filePath);
  const fileStats = fs.statSync(filePath);

  // Add schema + prompt to OpenAI thread
  console.log("Adding user message to thread:", threadId);
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: `Schema: ${JSON.stringify(columns)}\nRequest: ${prompt}`,
  });

  // Save user message to DB with file metadata
  let fileMsg = null;
  try {
    const saved = await saveMessageByThreadId({
      threadId,
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
    console.log("Saved user message with file for thread:", threadId);
  } catch (e) {
    console.warn("Failed to save user message:", e.message);
  }

  if (!silent) {
    // 🔎 Normal mode → Run the assistant and save its SQL reply
    console.log("Creating run for assistant:", process.env.SQL_ASSISTANT_ID);
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: process.env.SQL_ASSISTANT_ID,
    });
    console.log("Run create response:", JSON.stringify(run, null, 2));
    if (!run?.id) throw new Error("Failed to create run (no id in response)");
    console.log("Run created with id:", run.id);

    // Poll until run completes
    let runStatus;
    let attempts = 0;
    const maxAttempts = 30;
    console.log("About to poll run. threadId =", threadId, "run.id =", run.id);

    do {
      runStatus = await openai.beta.threads.runs.retrieve(run.id, {
        thread_id: threadId,
      });
      console.log(
        `Polling run ${run.id} (attempt ${attempts}): status =`,
        runStatus.status
      );

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
    console.log("Messages list response:", JSON.stringify(messages, null, 2));

    const lastAssistantMsg = messages.data.find((msg) => msg.role === "assistant");

    const lastMsg =
      lastAssistantMsg?.content?.[0]?.text?.value ||
      messages.data[0]?.content?.[0]?.text?.value ||
      "";

    console.log("Assistant reply extracted:", lastMsg);

    // Save assistant reply to DB
    try {
      await saveMessageByThreadId({
        threadId,
        sender: "bot",
        text: lastMsg,
        dbFileMessageId: fileMsg ? fileMsg._id : null, // link to file message
      });
      console.log("Saved assistant reply with dbFileMessageId:", fileMsg?._id);
    } catch (e) {
      console.warn("Failed to save bot message:", e.message);
    }

    console.log("=== processUploadAndAnalyze END ===");
    return { columns, aiText: lastMsg.trim(), threadId, fileMsg };
  } else {
    // ⚡ Silent mode → Skip assistant reply
    console.log("⚡ Silent mode: skipping assistant SQL generation");
    console.log("=== processUploadAndAnalyze END (silent) ===");
    return { columns, aiText: "", threadId, fileMsg };
  }
};
