// controllers/chatController.js
import { generateSqlFromSchema } from "../services/chatService.js";

export const chatWithSqlAssistant = async (req, res) => {
  try {
    const { schema, request } = req.body;

    const sqlQuery = await generateSqlFromSchema(schema, request);

    res.json({ sql: sqlQuery });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
