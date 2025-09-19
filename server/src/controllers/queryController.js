import openai from "../utils/openaiClient.js";
import { setDb, getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import Message from "../schemas/messageSchema.js";
import fs from "fs";
import os from "os";
import path from "path";

export const runSqlQuery = async (req, res) => {
  try {
    const { query, messageId, threadId, dbFileMessageId } = req.body;

    if (!query?.trim()) {
      return res.status(400).json({ error: "No SQL query provided." });
    }

    let dbPath = null;
    let foundVia = "unknown";

    console.log("=== SQL Query Execution Debug ===");
    console.log("Request params:", { messageId, threadId, dbFileMessageId });

    // Strategy 1: Use explicit dbFileMessageId if provided
    if (dbFileMessageId) {
      try {
        console.log("Strategy 1: Looking for DB file with dbFileMessageId:", dbFileMessageId);
        const fileMsg = await Message.findById(dbFileMessageId);
        
        if (fileMsg?.file?.data) {
          const tmpPath = path.join(
            os.tmpdir(),
            `${Date.now()}-${fileMsg.file.name}`
          );
          fs.writeFileSync(tmpPath, fileMsg.file.data);
          setDb(tmpPath);
          dbPath = tmpPath;
          foundVia = "explicit_dbFileMessageId";
          console.log("✅ Strategy 1 SUCCESS: Using DB file from explicit dbFileMessageId:", tmpPath);
        } else {
          console.log("❌ Strategy 1 FAILED: File message found but no file data");
        }
      } catch (err) {
        console.log("❌ Strategy 1 ERROR:", err.message);
      }
    }

    // Strategy 2: Look up the message and use its dbFileMessageId
    if (!dbPath && messageId) {
      try {
        console.log("Strategy 2: Looking up message to find dbFileMessageId:", messageId);
        const msg = await Message.findById(messageId);
        if (msg?.dbFileMessageId) {
          console.log("Found dbFileMessageId in message:", msg.dbFileMessageId);
          const fileMsg = await Message.findById(msg.dbFileMessageId);
          if (fileMsg?.file?.data) {
            const tmpPath = path.join(
              os.tmpdir(),
              `${Date.now()}-${fileMsg.file.name}`
            );
            fs.writeFileSync(tmpPath, fileMsg.file.data);
            setDb(tmpPath);
            dbPath = tmpPath;
            foundVia = "message_dbFileMessageId";
            console.log("✅ Strategy 2 SUCCESS: Using DB file from message's dbFileMessageId:", tmpPath);
          } else {
            console.log("❌ Strategy 2 FAILED: File message found but no file data");
          }
        } else {
          console.log("❌ Strategy 2 FAILED: Message has no dbFileMessageId");
        }
      } catch (err) {
        console.log("❌ Strategy 2 ERROR:", err.message);
      }
    }

    // Strategy 3: Find the most recent file in the thread
    if (!dbPath && threadId) {
      try {
        console.log("Strategy 3: Searching for any file in thread:", threadId);
        const fileMsg = await Message.findOne({
          threadId,
          "file.name": { $exists: true, $ne: null },
        }).sort({ createdAt: -1 });
        
        if (fileMsg?.file?.data) {
          const tmpPath = path.join(
            os.tmpdir(),
            `${Date.now()}-${fileMsg.file.name}`
          );
          fs.writeFileSync(tmpPath, fileMsg.file.data);
          setDb(tmpPath);
          dbPath = tmpPath;
          foundVia = "thread_search";
          console.log("✅ Strategy 3 SUCCESS: Using DB file from thread search:", tmpPath);
        } else {
          console.log("❌ Strategy 3 FAILED: No file messages found in thread");
        }
      } catch (err) {
        console.log("❌ Strategy 3 ERROR:", err.message);
      }
    }

    // Strategy 4: Fallback to global DB path
    if (!dbPath) {
      const globalPath = getDb();
      if (globalPath && fs.existsSync(globalPath)) {
        dbPath = globalPath;
        foundVia = "global_fallback";
        console.log("✅ Strategy 4 SUCCESS: Using global DB path:", dbPath);
      } else {
        console.log("❌ All strategies failed - no database context found");
        return res.status(400).json({ 
          error: "No database file found. Please upload a database file first.",
          debug: {
            messageId,
            threadId,
            dbFileMessageId,
            strategiesTried: ["explicit_dbFileMessageId", "message_dbFileMessageId", "thread_search", "global_fallback"]
          }
        });
      }
    }

    console.log(`🎯 Final result: Using DB found via ${foundVia}: ${dbPath}`);

    // Load schema
    const schema = await fileHandler(dbPath);
    console.log("Schema loaded:", Object.keys(schema));

    // Ask OpenAI to simulate running the query
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a SQL execution engine. 
          The user will give you:
          1) A database schema in JSON.
          2) An SQL query.
          You must return only JSON rows that would result from running the query on that schema. 
          Use realistic sample data if needed.
          Return the result as a JSON object with a "rows" array.`,
        },
        {
          role: "user",
          content: `Schema: ${JSON.stringify(schema, null, 2)}\n\nQuery: ${query}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    // Parse JSON safely
    let rows = [];
    try {
      const raw = completion.choices[0].message.content;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        rows = parsed;
      } else if (parsed.rows && Array.isArray(parsed.rows)) {
        rows = parsed.rows;
      } else if (parsed.data && Array.isArray(parsed.data)) {
        rows = parsed.data;
      } else {
        // If the response is an object but not the expected format, try to extract rows
        rows = Object.values(parsed).find(val => Array.isArray(val)) || [];
      }
    } catch (err) {
      console.error("Failed to parse OpenAI response:", err.message);
      console.error("Raw response:", completion.choices[0].message.content);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    console.log(`Query executed successfully, returning ${rows.length} rows`);
    
    // Clean up temporary file if we created one
    if (foundVia !== "global_fallback" && dbPath && fs.existsSync(dbPath)) {
      setTimeout(() => {
        try {
          fs.unlinkSync(dbPath);
          console.log("Cleaned up temporary file:", dbPath);
        } catch (err) {
          console.warn("Failed to clean up temporary file:", err.message);
        }
      }, 1000);
    }

    res.json({ rows, foundVia });
  } catch (err) {
    console.error("Run query error:", err);
    res.status(500).json({ error: err.message });
  }
};