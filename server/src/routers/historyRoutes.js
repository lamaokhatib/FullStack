// src/routers/historyRoutes.js
import express from "express";
import { getUploadHistory, downloadFileFromHistory } from "../controllers/historyController.js";

const router = express.Router();

router.get("/history/uploads", getUploadHistory);
router.get("/history/download/:messageId", downloadFileFromHistory);

export default router;