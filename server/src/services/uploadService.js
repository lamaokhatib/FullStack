// services/uploadService.js
import openai from "../utils/openaiClient.js";
import fileHandler from "../utils/fileHandler.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";

export const processUploadAndAnalyze = async (
  filePath,
  prompt,
  existingThreadId = null
) => {
  if (!filePath) throw new Error("No file uploaded");
  if (!prompt?.trim()) throw new Error("Missing prompt");

  const columns = await fileHandler(filePath);

  console.log("=== processUploadAndAnalyze START ===");
  console.log("Incoming params:", { filePath, prompt, existingThreadId });

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

  // Add schema + prompt to OpenAI
  console.log("Adding user message to thread:", threadId);
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: `Schema: ${JSON.stringify(columns)}\nRequest: ${prompt}`,
  });

  // Save user message to DB
  try {
    await saveMessageByThreadId({
      threadId,
      sender: "user",
      text: prompt,
      title: prompt.slice(0, 60),
    });
    console.log("Saved user message for thread:", threadId);
  } catch (e) {
    console.warn("Failed to save user message:", e.message);
  }

  // Run the assistant
  console.log("Creating run for assistant:", process.env.SQL_ASSISTANT_ID);
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: process.env.SQL_ASSISTANT_ID,
  });
  console.log("Run create response:", JSON.stringify(run, null, 2));
  if (!run?.id) throw new Error("Failed to create run (no id in response)");
  console.log("Run created with id:", run.id);

  // Poll until run completes (fixed for openai@5.16.0)
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

  // Get assistant’s reply
  const messages = await openai.beta.threads.messages.list(threadId);
  console.log("Messages list response:", JSON.stringify(messages, null, 2));

  const lastAssistantMsg = messages.data.find(
    (msg) => msg.role === "assistant"
  );
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
    });
    console.log("Saved assistant reply for thread:", threadId);
  } catch (e) {
    console.warn("Failed to save bot message:", e.message);
  }

  console.log("=== processUploadAndAnalyze END ===");

  return { columns, aiText: lastMsg.trim(), threadId };
};
