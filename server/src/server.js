// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import chatRoutes from "./routers/chatRoutes.js";
import fileHandler from "./utils/fileHandler.js";
import { sendJsonAndTextToOpenAI } from "./utils/sendJsonAndTextToOpenAI.js";

// Env setup
dotenv.config();

// For __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// API routes
app.use("/api", chatRoutes);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "dbs");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// Upload + OpenAI endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const filePath = req.file.path;
    const columns = await fileHandler(filePath);

    const prompt = (typeof req.body?.prompt === "string" ? req.body.prompt : "").trim();
    if (!prompt) {
      return res.status(400).json({
        error: 'Missing prompt. Send it as a form-data field named "prompt" along with the file.'
      });
    }

    const aiText = await sendJsonAndTextToOpenAI({
      jsonObject: columns,
      text: prompt,
      model: "gpt-4o-mini"
    });

    res.json({
      message: "File uploaded and analyzed successfully",
      file: req.file.originalname,
      columns,
      openai: aiText
    });
  } catch (err) {
    console.error(err);
    const msg = err?.error?.message || err?.response?.data?.error?.message || err.message || "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
