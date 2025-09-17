// server/src/routers/db.router.js
import express from "express";
import fs from "fs";
import { fileMap, makeFile } from "../services/dbFileService.js";
import { generateSqlWithAI } from "../services/generateSqlWithAI.js";
const router = express.Router();

router.post("/generate/ai", express.json(), async (req, res) => {
  try {
    const { schemaText, filename = "database" } = req.body || {};
    if (!schemaText)
      return res.status(400).json({ error: "schemaText is required" });

    const sql = await generateSqlWithAI(schemaText);
    const { id, filename: outName } = makeFile({
      sql,
      format: "sql",
      filename,
    });
    const url = `${req.protocol}://${req.get("host")}${
      req.baseUrl
    }/download/${id}`;

    res.json({ sql, download: { url, filename: outName } });
  } catch (e) {
    console.error("AI generate error:", e);
    res.status(500).json({ error: e.message || "Failed to generate SQL" });
  }
});

// Optional direct API (handy for testing without LLM)
router.post("/generate", express.json(), (req, res) => {
  const {
    schemaText,
    sql,
    format = "sqlite",
    filename = "database",
  } = req.body || {};
  if (!schemaText && !sql)
    return res.status(400).json({ error: "schemaText or sql is required" });
  const { id, filename: outName } = makeFile({
    schemaText,
    sql,
    format,
    filename,
  });
  // Build absolute URL that reflects the mount path (/api/db)
  const proto = req.protocol; // "http"
  const host = req.get("host"); // "localhost:3000"
  const url = `${proto}://${host}${req.baseUrl}/download/${id}`;
  res.json({ download: { url, filename: outName } });
});

router.get("/download/:id", (req, res) => {
  console.log("Download requested:", req.params.id, "Known IDs:", [
    ...fileMap.keys(),
  ]);
  const f = fileMap.get(req.params.id);
  if (!f) return res.status(404).send("Not found");
  res.download(f.path, f.name, () => {
    try {
      fs.unlinkSync(f.path);
    } catch {}
    fileMap.delete(req.params.id);
    console.log("Download finished & cleaned:", req.params.id);
  });
});

export default router;
