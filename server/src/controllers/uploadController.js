// controllers/uploadController.js
import { processUploadAndAnalyze } from "../services/uploadService.js";

export const uploadHandler = async (req, res) => {
  try {
    // file is available thanks to multer middleware
    const filePath = req.file?.path; // if you switch to diskStorage
    const prompt = req.body.text;

    const result = await processUploadAndAnalyze(filePath, prompt);

    res.json({
      reply: result.aiText,
      schema: result.columns,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
};
