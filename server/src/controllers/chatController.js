import client from "../utils/openaiClient.js";

if (!process.env.SQL_ASSISTANT_ID) {
  console.error("SQL_ASSISTANT_ID not set in .env");
}

export const chatWithSqlAssistant = async (req, res) => {
  try {
    const { schema, request } = req.body;

    if (!schema || !request) {
      return res.status(400).json({ error: "Missing schema or request in body" });
    }

    // 1️⃣ Create a new thread
    const thread = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Schema: ${JSON.stringify(schema)}\nRequest: ${request}`,
        },
      ],
    });

    // 2️⃣ Get the assistant's response
    const assistantMessage = thread.choices?.[0]?.message?.content || "";

    res.json({ sql: assistantMessage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
