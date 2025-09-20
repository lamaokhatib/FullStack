// server/src/controllers/quickResultController.js
import { processUploadAndAnalyze } from "../services/uploadService.js";
import { runSqlQuery } from "./queryController.js";
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb, setDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import openai from "../utils/openaiClient.js";

export const quickResult = async (req, res) => {
  try {
    console.log("🔥 QuickResult called:", {
      prompt: req.body?.prompt,
      threadId: req.body?.threadId,
    });

    const prompt = req.body?.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    let threadId = req.body?.threadId || null;
    let fileMsg = null;
    let savedUser = null;

    // If a file is uploaded → process it silently (no assistant SQL, just schema/thread + user save)
    if (req.file) {
      const result = await processUploadAndAnalyze(
        req.file.path,
        prompt,
        threadId,
        true // 👈 silent mode: don’t auto-save assistant reply
      );

      threadId = result.threadId;
      fileMsg = result.fileMsg;
      savedUser = result.userMessage || null;

      // Set DB for schema + query execution
      setDb(req.file.path);

      console.log("✅ File processed, threadId set to:", threadId);
    } else {
      // No file → ensure a thread exists
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        console.log("✅ New thread created:", threadId);
      }

      // Save user message manually (only once here)
      console.log("💾 Saving user message to DB (no file)");
      savedUser = await saveMessageByThreadId({
        threadId,
        sender: "user",
        text: prompt,
        title: prompt.slice(0, 60),
      });
      console.log("✅ User message saved with ID:", savedUser.message._id);
    }

    // Load schema
    console.log("📊 Loading schema from DB:", getDb());
    const dbPath = getDb();
    const schema = await fileHandler(dbPath);
    console.log("✅ Schema loaded:", Object.keys(schema));

    // Generate SQL with AI
    console.log("🤖 Asking OpenAI to generate SQL for prompt");
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
    console.log("✅ Generated SQL:", sql);

    // Run SQL immediately
    console.log("▶️ Running generated SQL");
    let queryResult;
    await runSqlQuery(
      { body: { query: sql, threadId, messageId: savedUser?.message?._id } },
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
    console.log("✅ runSqlQuery returned rows:", queryResult.rows.length);

    // Save bot result message
    console.log("💾 Saving bot result message with rows:", queryResult.rows.length);
    const savedBot = await saveMessageByThreadId({
      threadId,
      sender: "bot",
      rows: queryResult.rows,
      type: "result",
      dbFileMessageId: fileMsg ? fileMsg._id : null,
    });
    console.log("✅ Bot result message saved");

    // Respond to frontend
    console.log(
      "📤 Sending response back to frontend with",
      queryResult.rows.length,
      "rows"
    );
    return res.json({
      rows: queryResult.rows,
      threadId,
      messageId: savedBot.message._id,
    });
  } catch (err) {
    console.error("Quick result error:", err);
    res.status(500).json({ error: err.message });
  }
};
