// controllers/chatController.js
import { chatFlowWithAssistant } from "../services/chatService.js";

export const chatWithSqlAssistant = async (req, res) => {
  try {
    const { threadId, message } = req.body ?? {};
    if (!message?.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // ⬇️ allow the service to return { aiText, threadId, download? }
    const result = await chatFlowWithAssistant(message, threadId);

    return res.json({
      openai: result.aiText ?? null,
      threadId: result.threadId ?? threadId ?? null,
      // ⬇️ key part: include a real download (url + filename) if present
      ...(result.download ? { download: result.download } : {})
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
};
