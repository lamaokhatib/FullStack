import { processUploadAndAnalyze } from "../services/uploadService.js";
import { setDb } from "../config/dbState.js";

export const handleFileUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { path: filePath, originalname } = req.file;
    const prompt = (typeof req.body?.prompt === "string" ? req.body.prompt : "").trim();
    const threadId = req.body?.threadId || null;
    const userId = req.body?.userId || null; // 👈 NEW

    setDb(filePath); // keep schema available for queries

    const { columns, aiText, threadId: newThreadId } =
      await processUploadAndAnalyze(filePath, prompt, threadId, false, userId); // 👈 pass userId

    res.json({
      message: "File uploaded and analyzed successfully",
      file: originalname,
      columns,
      openai: aiText,
      threadId: newThreadId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
};
