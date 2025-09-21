import { processUploadAndAnalyze } from "../services/uploadService.js";
import { runSqlQuery } from "./queryController.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb, setDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import openai from "../utils/openaiClient.js";

export const quickResult = async (req, res) => {
  try {
    const prompt = req.body?.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    const userId = req.body?.userId ?? null;
    let threadId = req.body?.threadId || null;
    let fileMsg = null;
    let savedUser = null;

    // If a file is uploaded → process it silently
    if (req.file) {
      const result = await processUploadAndAnalyze(
        req.file.path,
        prompt,
        threadId,
        true,    // silent
        userId   // 👈 stamp chat owner
      );

      threadId = result.threadId;
      fileMsg = result.fileMsg;
      savedUser = result.userMessage || null;

      // Set DB for schema + query execution
      setDb(req.file.path);
    } else {
      // No file → ensure a thread exists
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
      }

      // Save user message (stamps chat owner)
      savedUser = await saveMessageByThreadId({
        threadId,
        userId,  // 👈
        sender: "user",
        text: prompt,
        title: prompt.slice(0, 60),
      });
    }

    // Load schema
    const dbPath = getDb();
    const schema = await fileHandler(dbPath);

    // Generate SQL with AI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Generate only a SQL query string, nothing else." },
        {
          role: "user",
          content: `Schema: ${JSON.stringify(schema)}\n\nRequest: ${prompt}`,
        },
      ],
    });
    const sql = completion.choices[0].message.content.trim();

    // Run SQL immediately
    let queryResult;
    await runSqlQuery(
      { body: { query: sql, threadId, messageId: savedUser?.message?._id } },
      {
        json: (data) => { queryResult = data; return data; },
        status: (code) => ({ json: (data) => { queryResult = { code, ...data }; return data; } }),
      }
    );

    if (!queryResult?.rows) throw new Error("No rows returned");

    // Save bot result message
    await saveMessageByThreadId({
      threadId,
      userId, // 👈
      sender: "bot",
      rows: queryResult.rows,
      type: "result",
      dbFileMessageId: fileMsg ? fileMsg._id : null,
    });

    // Respond to frontend
    return res.json({
      rows: queryResult.rows,
      threadId,
    });
  } catch (err) {
    console.error("Quick result error:", err);
    res.status(500).json({ error: err.message });
  }
};
