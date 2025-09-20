//src/routers/chatRoutes.js
import express from "express";
import { chatWithSqlAssistant } from "../controllers/chatController.js";
import { listChats } from '../controllers/chatController.js';
import { quickResult } from "../controllers/quickResultController.js";
import uploadJson from "../middleware/uploadJson.js";
const router = express.Router();

// The chat Flow endpoint
router.post("/chat/flow", chatWithSqlAssistant);

// The quick result endpoint (with optional file upload)
router.post("/chat/quick-result", uploadJson.single("file"), quickResult);

// List all chats
router.get('/chats', listChats);

export default router;
