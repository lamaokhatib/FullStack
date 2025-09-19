// server/src/server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import chatRoutes from "./routers/chatRoutes.js";
import uploadRoutes from "./routers/uploadRoutes.js";
import queryRoutes from "./routers/queryRoutes.js";
import messageRoutes from "./routers/messageRoutes.js";
import { connectMongo } from "./db/mongo.js";
import dbRouter from "./routers/db.router.js";
import nlpRouter from "./routers/nlp.router.js";
import sqlRouter from "./routers/sql.router.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// API routes
app.use("/api", chatRoutes);
app.use("/api", uploadRoutes);
app.use("/api", queryRoutes);
app.use("/api/db", dbRouter);
app.use("/api", messageRoutes);
app.use("/api/nlp", nlpRouter);
app.use("/api/sql", sqlRouter);

// Start only after Mongo connects
async function start() {
  await connectMongo();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
start();
