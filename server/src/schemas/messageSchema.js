import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const fileSubSchema = new Schema(
  {
    name: String,
    path: String,
    size: Number,
    mimeType: String,
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    chat: { type: Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    sender: { type: String, enum: ['user', 'bot'], required: true },
    text: { type: String, default: '' },
    file: { type: fileSubSchema, default: undefined },
    threadId: { type: String, index: true },
  },
  { timestamps: true }
);

export default model('Message', messageSchema);