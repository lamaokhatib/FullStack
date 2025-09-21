// server/src/controllers/quickResultController.js


import { processUploadAndAnalyze } from "../services/uploadService.js";
import { runSqlQuery } from "./queryController.js"; // same folder, keep "./"
import { saveMessageByThreadId } from "../utils/chatRepository.js";
import { getDb, setDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import openai from "../utils/openaiClient.js";


import fs from "fs";

// (keep) Generate a quick result from prompt (+ optional file)
export const quickResult = async (req, res) => {
  try {
    const prompt = req.body?.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    const userId = req.body?.userId ?? null;
    let threadId = req.body?.threadId || null;
    let fileMsg = null;
    let savedUser = null;

    // (keep) If a file is uploaded → process it silently
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

      // (keep) Set DB for schema + query execution
      setDb(req.file.path);
    } else {
      // (keep) No file → ensure a thread exists
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
      }

      // (keep) Save user message (stamps chat owner)
      savedUser = await saveMessageByThreadId({
        threadId,
        userId,  // 👈
        sender: "user",
        text: prompt,
        title: prompt.slice(0, 60),
      });
    }

    // (keep) Load schema
    const dbPath = getDb();

    // ADDED: require a real DB file to be present; avoids falling into any AI fallback deeper down
    if (!dbPath || !fs.existsSync(dbPath)) {
      return res.status(400).json({
        error: "No database loaded. Upload a .db/.sqlite/.sql/.json/.csv file before using Quick Result.",
      });
    }

    const schema = await fileHandler(dbPath);

    // (keep) Generate SQL with AI — but restrict to a runnable SELECT/WITH
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        // CHANGED: make the model return only a valid SQLite SELECT/WITH query
        { role: "system", content: "Generate only a valid SQLite SELECT or WITH query that runs on the provided schema. No DDL/DML/PRAGMA. No explanations. Return only the raw SQL." },
        {
          role: "user",
          content: `Schema: ${JSON.stringify(schema)}\n\nRequest: ${prompt}`,
        },
      ],
    });
    const sql = completion.choices[0].message.content.trim();

    // (keep) Run SQL immediately
    let queryResult;
    await runSqlQuery(
      {
        body: {
          query: sql,
          threadId,
          messageId: savedUser?.message?._id,
          // ADDED: pass the uploaded file reference so the runner uses the exact file DB
          dbFileMessageId: fileMsg ? fileMsg._id : null,
        },
      },
      {
        // (keep) capture the JSON body
        json: (data) => {
          queryResult = data;
          return data;
        },
        // FIXED: the stub used `{ code, .data }` which broke error capture
        status: (code) => ({
          json: (data) => {
            queryResult = { code, ...data };
            return data;
          },
        }),
      }
    );

    if (!queryResult?.rows) throw new Error("No rows returned");

    // (keep) Save bot result message
    await saveMessageByThreadId({
      threadId,
      userId, // 👈
      sender: "bot",
      rows: queryResult.rows,
      type: "result",
      dbFileMessageId: fileMsg ? fileMsg._id : null,
    });

    // (keep) Respond to frontend
    return res.json({
      rows: queryResult.rows,
      threadId,
    });
  } catch (err) {
    console.error("Quick result error:", err);
    res.status(500).json({ error: err.message });
  }
};
