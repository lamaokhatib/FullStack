// src/controllers/historyController.js
import Message from '../schemas/messageSchema.js';

// Get all uploaded files from message history
export const getUploadHistory = async (req, res) => {
  try {
    // Find all messages that have file attachments
    const messagesWithFiles = await Message.find({
      'file.name': { $exists: true, $ne: null }
    })
    .select('file text createdAt threadId')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

    // Transform the data for the frontend
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