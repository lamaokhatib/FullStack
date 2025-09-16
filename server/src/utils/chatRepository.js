import Chat from '../schemas/chatSchema.js';
import Message from '../schemas/messageSchema.js';

export async function getOrCreateChat({ threadId, title }) {
  if (!threadId) throw new Error('threadId is required');
  let chat = await Chat.findOne({ threadId });
  if (!chat) {
    chat = await Chat.create({ threadId, title });
  }
  return chat;
}

export async function saveMessage({ chatId, sender, text, file, threadId }) {
  if (!chatId) throw new Error('chatId is required');
  if (!sender) throw new Error('sender is required');
  return Message.create({
    chat: chatId,
    sender,
    text: text ?? '',
    file,
    threadId,
  });
}

// Convenience: save by threadId (creates chat if needed)
export async function saveMessageByThreadId({ threadId, sender, text, file, title }) {
  const chat = await getOrCreateChat({ threadId, title });
  const msg = await saveMessage({ chatId: chat._id, sender, text, file, threadId });
  return { chat, message: msg };
}