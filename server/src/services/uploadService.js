// services/uploadService.js
import openai from "../utils/openaiClient.js";
import fileHandler from "../utils/fileHandler.js";

export const processUploadAndAnalyze = async (filePath, prompt, existingThreadId = null) => {
  if (!filePath) throw new Error("No file uploaded");
  if (!prompt?.trim()) throw new Error("Missing prompt");

  const columns = await fileHandler(filePath);

  // ✅ reuse thread if exists
  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await openai.beta.threads.create();
    if (!thread?.id) throw new Error("Failed to create thread");
    console.log("Thread created:", thread.id);
    threadId = thread.id;
  } else {
    console.log("Reusing thread:", threadId);
  }

  // 2. Add schema + prompt
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: `Schema: ${JSON.stringify(columns)}\nRequest: ${prompt}`,
  });

  // 3. Run the assistant
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: process.env.SQL_ASSISTANT_ID,
  });
  if (!run?.id) throw new Error("Failed to create run");
  console.log("Run created:", run.id);

  // 4. Poll until run completes
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

  // 5. Get assistant’s reply
  const messages = await openai.beta.threads.messages.list(threadId);
  const lastAssistantMsg = messages.data.find((msg) => msg.role === "assistant");
  const lastMsg =
    lastAssistantMsg?.content?.[0]?.text?.value ||
    messages.data[0]?.content?.[0]?.text?.value ||
    "";

  return { columns, aiText: lastMsg.trim(), threadId };
};
