// server/src/routers/sql.router.js
import express from "express";
import { generateQueryWithAI } from "../services/generateQueryWithAI.js";

const router = express.Router();

/** POST /api/sql/generate  { question } -> { sql } */
router.post("/generate", express.json(), async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question?.trim()) {
      return res.status(400).json({ error: "question is required" });
    }
    const sql = await generateQueryWithAI(question);
    res.json({ sql });
  } catch (e) {
    console.error("sql.generate error:", e);
    res.status(500).json({ error: e.message || "failed to generate SQL" });
  }
});

export default router;
