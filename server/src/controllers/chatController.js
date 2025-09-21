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

    // allow the service to return { aiText, threadId, download? }
    const result = await chatFlowWithAssistant(message, threadId);

    // ensure absolute URL for download (so the anchor works in the browser)
    let download = result.download || null;
    if (download?.url && download.url.startsWith("/")) {
      download = {
        ...download,
        url: `${req.protocol}://${req.get("host")}${download.url}`,
      };
    }

    return res.json({
      openai: result.aiText ?? null,
      threadId: result.threadId ?? threadId ?? null,
      ...(download ? { download } : {}),
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
};
