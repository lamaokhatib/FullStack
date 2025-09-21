import Chat from '../schemas/chatSchema.js';
import Message from '../schemas/messageSchema.js';

export async function getOrCreateChat({ threadId, title, userId = null }) {
  if (!threadId) throw new Error('threadId is required');

  // Prefer an existing chat for this user (if provided), otherwise any by threadId
  let chat = userId
    ? await Chat.findOne({ threadId, user: userId })
    : await Chat.findOne({ threadId });

  if (!chat) {
    chat = await Chat.create({ threadId, title, user: userId ?? null });
  } else if (userId && !chat.user) {
    // backfill owner on old chats that were created before this change
    chat.user = userId;
    await chat.save();
  }
  return chat;
}

export async function saveMessage({
  chatId,
  userId = null,   // not stored on messages per your request
  sender,
  text,
  file,
  threadId,
  rows,
  edited = false,
  type = 'text',
  dbFileMessageId = null,
}) {
  if (!chatId) throw new Error('chatId is required');
  if (!sender) throw new Error('sender is required');
  return Message.create({
    chat: chatId,
    sender,
    text: text ?? '',
    file,
    threadId,
    rows,
    edited,
    type,
    dbFileMessageId,
  });
}

// Convenience: save by threadId (creates chat if needed)
export async function saveMessageByThreadId({
  threadId,
  userId = null,  // used only to stamp Chat owner
  sender,
  text,
  file,
  rows,
  title,
  edited = false,
  type = 'text',
  dbFileMessageId = null,
}) {
  const chat = await getOrCreateChat({ threadId, title, userId });
  const msg = await saveMessage({
    chatId: chat._id,
    userId,
    sender,
    text,
    file,
    threadId,
    rows,
    edited,
    type,
    dbFileMessageId,
  });
  return { chat, message: msg };
}
