// controllers/chatController.js
import { chatFlowWithAssistant } from "../services/chatService.js";
import Chat from "../schemas/chatSchema.js";
import Message from "../schemas/messageSchema.js"; // Import Message schema
import { getDb } from "../config/dbState.js"; // Import getDb function

// List recent chats
export const listChats = async (req, res) => {
  try {
    const chats = await Chat.find(
      {},
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
    const { threadId, message } = req.body ?? {};
    const userId = req.user._id; // Always use the authenticated user's ID
    if (!message?.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // allow the service to return { aiText, threadId, download? }
    const result = await chatFlowWithAssistant(message, threadId, userId);

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

export const sendMessage = async (req, res) => {
  try {
    const { prompt, threadId, dbFileMessageId } = req.body;
    const userId = req.user._id; // Get user ID from auth middleware

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    let currentThreadId = threadId;
    let chat;

    // If no threadId, create a new chat for the user
    if (!currentThreadId) {
      chat = new Chat({
        userId: userId,
        title: prompt.substring(0, 30), // Use the start of the prompt as title
      });
      await chat.save();
      currentThreadId = chat._id.toString();
    }

    // Save user message with user's ID as the sender
    const userMessage = new Message({
      chat: currentThreadId,
      sender: userId, // Use the user's ID
      text: prompt,
      threadId: currentThreadId,
      dbFileMessageId: dbFileMessageId,
    });
    await userMessage.save();

    const dbPath = getDb();

    // Call the AI service (assuming it uses the same chatFlowWithAssistant function)
    const aiText = await chatFlowWithAssistant(prompt, currentThreadId, userId);

    // Save AI response message
    const aiMessage = new Message({
      chat: currentThreadId,
      sender: "bot",
      text: aiText,
      threadId: currentThreadId,
      dbFileMessageId: userMessage._id, // Link AI response to the user's message which contains the file
    });
    await aiMessage.save();

    res.json({
      threadId: currentThreadId,
      userMessageId: userMessage._id,
      aiMessageId: aiMessage._id,
    });
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
};

export const getChatHistory = async (req, res) => {
  try {
    const { threadId } = req.params;

    const messages = await Message.find({ threadId })
      .sort({ createdAt: 1 })
      .populate("sender", "name email") // Populate sender details if needed
      .lean();

    res.json(messages);
  } catch (err) {
    console.error("getChatHistory error:", err);
    res.status(500).json({ error: "Failed to get chat history" });
  }
};