import express from "express";
import openai from "../utils/openaiClient.js";

const router = express.Router();

/**
 * POST /api/nlp/classify-intent
 * Body: { message: string }
 * Returns: { label: "question"|"sql_request"|"other", should_autorun: boolean, reason?: string }
 */
router.post("/classify-intent", express.json(), async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message?.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const completion = await openai.chat.completions.create({
      model: process.env.CLASSIFIER_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" }, // force JSON
      messages: [
        {
          role: "system",
          content: [
            "Classify the user's message.",
            "Output JSON only with keys:",
            '  - "label": "question" | "sql_request" | "other"',
            "    • question = user asks for info/results (e.g., 'Where do I find the comments?')",
            "    • sql_request = user asks to WRITE/GENERATE SQL (e.g., 'write a query that…', 'create SQL to…')",
            "    • other = anything else",
            '  - "should_autorun": boolean (true only if label == "question")',
            '  - "reason": short phrase (optional)',
          ].join("\n"),
        },
        { role: "user", content: message },
      ],
    });

    let obj = {};
    try {
      obj = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}");
    } catch {
      return res.status(502).json({ error: "bad classification response" });
    }

    // minimal sanity defaults
    const label = ["question", "sql_request", "other"].includes(obj.label)
      ? obj.label
      : "other";
    const should_autorun =
      typeof obj.should_autorun === "boolean"
        ? obj.should_autorun
        : label === "question";

    return res.json({ label, should_autorun, reason: obj.reason || "" });
  } catch (e) {
    console.error("classify-intent error:", e);
    res.status(500).json({ error: "classifier failed" });
  }
});

export default router;
