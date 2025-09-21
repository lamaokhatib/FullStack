import Message from '../schemas/messageSchema.js';
import Chat from '../schemas/chatSchema.js';

/**
 * Helper: resolve userId from header/query/body (keeps this change tiny).
 */
function getUserId(req) {
  return (
    req.headers['x-user-id'] ||
    req.query.userId ||
    req.body?.userId ||
    null
  );
}

/**
 * GET /api/history/uploads
 * Returns recent uploads for THIS user only (via Chat ownership).
 * Falls back to empty list if userId missing (safer default).
 */
export const getUploadHistory = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.json([]); // no user → no items

    // Find this user's chats
    const chats = await Chat.find({ user: userId }).select('_id').lean();
    const chatIds = chats.map(c => c._id);

    if (chatIds.length === 0) return res.json([]);

    // Only messages with files that belong to those chats
    const messagesWithFiles = await Message.find({
      chat: { $in: chatIds },
      'file.name': { $exists: true, $ne: null }
    })
      .select('file text createdAt threadId')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const history = messagesWithFiles.map(msg => ({
      id: msg._id.toString(),
      name: msg.file.name,
      size: msg.file.size,
      updatedAt: msg.file.uploadedAt || msg.createdAt.toISOString(),
      threadId: msg.threadId,
      preview: msg.text ? msg.text.substring(0, 100) : 'No description',
      mimeType: msg.file.mimeType
    }));

    res.json(history);
  } catch (err) {
    console.error("getUploadHistory error:", err);
    res.status(500).json({ error: "Failed to load upload history" });
  }
};

/**
 * GET /api/history/download/:messageId
 * Only allow download if the message belongs to a chat owned by this user.
 */
export const downloadFileFromHistory = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { messageId } = req.params;
    const message = await Message.findById(messageId).lean();
    if (!message || !message.file || !message.file.data) {
      return res.status(404).json({ error: "File not found" });
    }

    // Verify ownership via Chat
    const chat = await Chat.findById(message.chat).select('user').lean();
    if (!chat || String(chat.user) !== String(userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.setHeader('Content-Type', message.file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${message.file.name}"`);
    res.setHeader('Content-Length', message.file.data.length);
    res.send(message.file.data);
  } catch (err) {
    console.error("downloadFile error:", err);
    res.status(500).json({ error: "Failed to download file" });
  }
};
