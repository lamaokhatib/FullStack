// services/chatService.js
import client from "../utils/openaiClient.js";

export const generateSqlFromSchema = async (schema, request) => {
  if (!schema || !request) {
    throw new Error("Missing schema or request");
  }

  // Call OpenAI API
  const thread = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Schema: ${JSON.stringify(schema)}\nRequest: ${request}`,
      },
    ],
  });

  return thread.choices?.[0]?.message?.content || "";
};
