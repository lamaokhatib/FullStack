import express from "express";
import { chatWithSqlAssistant } from "../controllers/chatController.js";

const router = express.Router();

router.post("/chat/sql", chatWithSqlAssistant);

export default router;