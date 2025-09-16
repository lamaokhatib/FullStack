// controllers/chatController.js
import { chatFlowWithAssistant } from "../services/chatService.js";

export const chatWithSqlAssistant = async (req, res) => {
  try {
    const { threadId, message } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const { aiText, threadId: newThreadId } = await chatFlowWithAssistant(message, threadId);

    res.json({ openai: aiText, threadId: newThreadId });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
};
