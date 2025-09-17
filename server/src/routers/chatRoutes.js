//src/routers/chatRoutes.js
import express from "express";
import { chatWithSqlAssistant } from "../controllers/chatController.js";
import { listChats } from '../controllers/chatController.js';

const router = express.Router();

router.post("/chat/flow", chatWithSqlAssistant);
router.get('/chats', listChats);

export default router;
