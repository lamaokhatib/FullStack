import express from "express";
import uploadJson from "../middleware/uploadJson.js";
import { handleFileUpload } from "../controllers/uploadController.js";

const router = express.Router();

// Upload endpoint
router.post("/upload", uploadJson.single("file"), handleFileUpload);

export default router;
