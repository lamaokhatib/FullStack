import { processUploadAndAnalyze } from "../services/uploadService.js";
import { runSqlQuery } from "./queryController.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import openai from "../utils/openaiClient.js";

export const quickResult = async (req, res) => {
  try {
    const prompt = req.body?.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    let threadId = req.body?.threadId || null;
    let fileMsg = null;

    // If a file uploaded → process it
    if (req.file) {
      const result = await processUploadAndAnalyze(req.file.path, prompt, threadId);
      threadId = result.threadId;
      fileMsg = result.fileMsg;
    } else {
      // Ensure a thread exists
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
      }
    }

    // Save user message
    const savedUser = await saveMessageByThreadId({
      threadId,
      sender: "user",
      text: prompt,
      file: fileMsg ? fileMsg.file : undefined,
      title: prompt.slice(0, 60),
    });

    // Load schema
    const dbPath = getDb();
    const schema = await fileHandler(dbPath);

    // Generate SQL with AI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Generate only a SQL query string, nothing else." },
        { role: "user", content: `Schema: ${JSON.stringify(schema)}\n\nRequest: ${prompt}` },
      ],
    });
    const sql = completion.choices[0].message.content.trim();

    // Run SQL immediately (intercept runSqlQuery’s response)
    let queryResult;
    await runSqlQuery(
      { body: { query: sql, threadId, messageId: savedUser.message._id } },
      {
        json: (data) => {
          queryResult = data;
          return data;
        },
        status: (code) => ({
          json: (data) => {
            queryResult = { code, ...data };
            return data;
          },
        }),
      }
    );

    if (!queryResult?.rows) throw new Error("No rows returned");

    // Save bot message with rows
    await saveMessageByThreadId({
      threadId,
      sender: "bot",
      rows: queryResult.rows,
      type: "result",
      dbFileMessageId: fileMsg ? fileMsg._id : null,
    });

    // Respond to frontend
    return res.json({ rows: queryResult.rows, threadId });
  } catch (err) {
    console.error("Quick result error:", err);
    res.status(500).json({ error: err.message });
  }
};
