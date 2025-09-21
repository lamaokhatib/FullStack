import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const chatSchema = new Schema(
  {
    title: { type: String },
    threadId: { type: String, index: true },
    // NEW: owner of the chat (optional for backward compatibility)
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
  },
  { timestamps: true }
);

// helpful compound index (optional)
chatSchema.index({ user: 1, updatedAt: -1 });

export default model('Chat', chatSchema);
