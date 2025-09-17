// server/src/routers/messageRoutes.js
import express from "express";
import Message from "../schemas/messageSchema.js";

const router = express.Router();

// GET all messages for a given threadId
router.get("/messages/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!threadId) {
      return res.status(400).json({ error: "threadId is required" });
    }

    const messages = await Message.find({ threadId })
      .sort({ createdAt: 1 }) // oldest → newest
      .lean();

    res.json(messages);
  } catch (err) {
    console.error("listMessages error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

router.put("/messages/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!id || !text) {
      return res.status(400).json({ error: "id and text are required" });
    }

    const message = await Message.findByIdAndUpdate(id, { text }, { new: true });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json(message);
  } catch (err) {
    console.error("updateMessage error:", err);
    res.status(500).json({ error: "Failed to update message" });
  }
});

export default router;
