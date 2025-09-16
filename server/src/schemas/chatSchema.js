import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const chatSchema = new Schema(
  {
    title: { type: String },
    threadId: { type: String, index: true },
  },
  { timestamps: true }
);

export default model('Chat', chatSchema);