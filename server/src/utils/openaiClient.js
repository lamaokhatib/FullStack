  const OpenAI = require('openai');
  require('dotenv').config();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Put it in .env (not committed)');
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  module.exports = openai;
