// src/controllers/historyController.js
import Message from '../schemas/messageSchema.js';
import Chat from '../schemas/chatSchema.js';
import User from '../schemas/userSchema.js';

// Get all uploaded files from *this user's* message history
export const getUploadHistory = async (req, res) => {
  try {
    // 1) Resolve userId from session header or explicit param
    const headerSession =
      req.get("X-Session-Id") ||
      req.headers["x-session-id"] ||
      null;

    let userId =
      req.userId ||  
      req.query?.userId ||
      req.body?.userId ||
      null;

    if (!userId && headerSession) {
      const user = await User.findOne({ sessionId: headerSession }).select("_id");
      if (user) userId = user._id.toString();
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized (missing user/session)" });
    }

    // 2) Find all chats owned by this user
    const chats = await Chat.find({ user: userId })
      .select("_id threadId")
      .lean();

    const chatIds = chats.map(c => c._id);
    if (chatIds.length === 0) {
      return res.json([]); // no chats → no uploads
    }

    // 3) Find messages from these chats that include files
    const messagesWithFiles = await Message.find({
      chat: { $in: chatIds },
      "file.name": { $exists: true, $ne: null }
    })
      .select("file text createdAt threadId")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // 4) Transform for frontend
    const history = messagesWithFiles.map(msg => ({
      id: msg._id.toString(),
      name: msg.file.name,
      size: msg.file.size,
      updatedAt: msg.file.uploadedAt || msg.createdAt.toISOString(),
      threadId: msg.threadId,
      preview: msg.text ? msg.text.substring(0, 100) : "No description",
      mimeType: msg.file.mimeType
    }));

    res.json(history);
  } catch (err) {
    console.error("getUploadHistory error:", err);
    res.status(500).json({ error: "Failed to load upload history" });
  }
};

// Download a specific file from history
export const downloadFileFromHistory = async (req, res) => {
  try {
    const { messageId } = req.params;
    
    const message = await Message.findById(messageId);
    if (!message || !message.file || !message.file.data) {
      return res.status(404).json({ error: "File not found" });
    }

    // Set appropriate headers for download
    res.setHeader('Content-Type', message.file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${message.file.name}"`);
    res.setHeader('Content-Length', message.file.data.length);

    // Send the file buffer
    res.send(message.file.data);
  } catch (err) {
    console.error("downloadFile error:", err);
    res.status(500).json({ error: "Failed to download file" });
  }
};