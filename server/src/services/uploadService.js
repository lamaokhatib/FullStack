// services/uploadService.js
import openai from "../utils/openaiClient.js";
import fileHandler from "../utils/fileHandler.js";


export const processUploadAndAnalyze = async (filePath, prompt) => {
  if (!filePath) throw new Error("No file uploaded");
  if (!prompt?.trim()) throw new Error("Missing prompt");

  // Extract schema/columns
  const columns = await fileHandler(filePath);

  // 1. Create a new thread
  const thread = await openai.beta.threads.create();
  if (!thread?.id) {
    throw new Error("Failed to create thread");
  }
  console.log("Thread created:", thread.id);

  // 2. Add schema + prompt as a message
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: `Schema: ${JSON.stringify(columns)}\nRequest: ${prompt}`,
  });

  // 3. Run the assistant on this thread
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: process.env.SQL_ASSISTANT_ID,
  });
  if (!run?.id) {
    throw new Error("Failed to create run");
  }
  console.log("Run created:", run.id);

  // 4. Poll until run completes
  console.log("Polling run status with thread.id:", thread.id, "run.id:", run.id);
  let runStatus;
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max

  do {
    try {
      runStatus = await openai.beta.threads.runs.retrieve(run.id, { thread_id: thread.id });
      console.log("Run status:", runStatus.status);
    } catch (error) {
      console.log("Error retrieving run status:", error.message);
      // If we get the undefined error, try the alternative approach
      if (error.message.includes("Undefined")) {
        console.log("Trying alternative approach...");
        runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      } else {
        throw error;
      }
    }

    if (runStatus.status === "in_progress" || runStatus.status === "queued") {
      await new Promise((r) => setTimeout(r, 1000));
      attempts++;
    }
  } while ((runStatus.status === "in_progress" || runStatus.status === "queued") && attempts < maxAttempts);

  if (runStatus.status !== "completed") {
    throw new Error(`Run failed with status: ${runStatus.status}`);
  }

  // 5. Get the assistant’s reply (last assistant message)
  const messages = await openai.beta.threads.messages.list(thread.id);
  const lastAssistantMsg = messages.data.find(
    (msg) => msg.role === "assistant"
  );
  const lastMsg =
    lastAssistantMsg?.content?.[0]?.text?.value ||
    messages.data[0]?.content?.[0]?.text?.value ||
    "";

  return { columns, aiText: lastMsg.trim() };
};