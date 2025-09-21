import { chatFlowWithAssistant } from "../services/chatService.js";
import Chat from "../schemas/chatSchema.js";

// List chats (filtered by user if provided)
export const listChats = async (req, res) => {
  try {
    // accept userId from header/query/body to keep this change tiny
    const userId =
      req.headers["x-user-id"] ||
      req.query.userId ||
      req.body?.userId ||
      null;

    const where = userId ? { user: userId } : {}; // fallback: all chats (legacy)
    const chats = await Chat.find(
      where,
      { title: 1, threadId: 1, createdAt: 1, updatedAt: 1 }
    )
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    res.json(chats);
  } catch (err) {
    console.error("listChats error:", err);
    res.status(500).json({ error: "Failed to list chats" });
  }
};

export const chatWithSqlAssistant = async (req, res) => {
  try {
    const { threadId, message, userId } = req.body ?? {};
    if (!message?.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // pass userId so new chats get owned by that user
    const result = await chatFlowWithAssistant(message, threadId, userId);

    return res.json({
      openai: result.aiText ?? null,
      threadId: result.threadId ?? threadId ?? null,
      ...(result.download ? { download: result.download } : {})
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
};
