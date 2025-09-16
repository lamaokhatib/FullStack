import { processUploadAndAnalyze } from "../services/uploadService.js";
import { setDb } from "../config/dbState.js";   // ✅ import

export const handleFileUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { path: filePath, originalname } = req.file;
    const prompt = (typeof req.body?.prompt === "string" ? req.body.prompt : "").trim();
    const threadId = req.body?.threadId || null;

    // ✅ Save uploaded DB path so queries can run later
    setDb(filePath);

    const { columns, aiText, threadId: newThreadId } =
      await processUploadAndAnalyze(filePath, prompt, threadId);

    res.json({
      message: "File uploaded and analyzed successfully",
      file: originalname,
      columns,
      openai: aiText,
      threadId: newThreadId,
    });
  } catch (err) {
    console.error(err);
    const msg =
      err?.error?.message || err?.response?.data?.error?.message || err.message || "Unknown error";
    res.status(500).json({ error: msg });
  }
};
