// server/src/schemas/messageSchema.js
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const fileSubSchema = new Schema(
  {
    name: String,
    path: String,
    size: Number,
    mimeType: String,
    data: Buffer,
    uploadedAt: { type: Date, default: Date.now },
  },
);

const messageSchema = new Schema(
  {
    chat: { type: Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    sender: { type: String, required: true },
    text: { type: String, default: '' },
    file: { type: fileSubSchema, default: undefined },
    threadId: { type: String, index: true },
    rows: { type: [Schema.Types.Mixed], default: undefined }, // for query results
    edited: { type: Boolean, default: false },                // marks edited SQL
    type: { type: String, enum: ['text', 'sql', 'result'], default: 'text' },
    dbFileMessageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
  },
  { timestamps: true }
);

export default model('Message', messageSchema);