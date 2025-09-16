//src/routers/queryRoutes.js
import express from "express";
import { runSqlQuery } from "../controllers/queryController.js";

const router = express.Router();

router.post("/query/run", runSqlQuery);

export default router;
