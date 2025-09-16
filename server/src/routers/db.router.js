// server/src/routers/db.router.js
import express from "express";
import { fileMap, makeFile } from "../services/dbFileService.js";

const router = express.Router();

// Optional direct API (handy for testing without LLM)
router.post("/generate", express.json(), (req, res) => {
  const { schemaText, sql, format = "sqlite", filename = "database" } = req.body || {};
  if (!schemaText && !sql) return res.status(400).json({ error: "schemaText or sql is required" });
  const { id, filename: outName } = makeFile({ schemaText, sql, format, filename });
  res.json({ download: { url: `/db/download/${id}`, filename: outName } });
});

router.get("/download/:id", (req, res) => {
  const f = fileMap.get(req.params.id);
  if (!f) return res.status(404).send("Not found");
  res.download(f.path, f.name, () => {
    try { fs.unlinkSync(f.path); } catch {}
    fileMap.delete(req.params.id);
  });
});

export default router;
