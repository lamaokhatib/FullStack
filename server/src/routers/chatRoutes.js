//src/routers/chatRoutes.js
import express from "express";
import { chatWithSqlAssistant } from "../controllers/chatController.js";

const router = express.Router();

// ✅ Now works with thread reuse
router.post("/chat/flow", chatWithSqlAssistant);

export default router;
