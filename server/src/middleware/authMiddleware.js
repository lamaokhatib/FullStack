import User from "../schemas/userSchema.js";

export default async function authMiddleware(req, res, next) {
  try {
    const bearer = req.headers.authorization || "";
    const viaBearer = bearer.replace(/^Bearer\s+/i, "");
    const viaHeader = req.header("X-Session-Id");
    const sessionId = viaHeader || viaBearer;

    if (!sessionId) return res.status(401).json({ error: "Missing session" });

    const user = await User.findOne({ sessionId }).select("_id username");
    if (!user) return res.status(401).json({ error: "Invalid session" });

    req.userId = user._id;
    req.user = user;
    next();
  } catch (e) {
    console.error("authMiddleware error:", e.message);
    res.status(500).json({ error: "Auth failed" });
  }
}
