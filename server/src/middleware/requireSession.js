// server/src/middleware/requireSession.js
import User from "../schemas/userSchema.js";

/**
 * Reads X-Session-Id and attaches req.userId (Mongo _id) if valid.
 * Returns 401 when there is no valid session.
 */
export default async function requireSession(req, res, next) {
  try {
    const headerId = req.get("X-Session-Id") || req.headers["x-session-id"];
    const bodyId = req.body?.sessionId; // for /auth/logout convenience
    const sessionId = headerId || bodyId;

    if (!sessionId) {
      return res.status(401).json({ error: "Unauthorized (missing session)" });
    }

    const user = await User.findOne({ sessionId }).select("_id");
    if (!user) {
      return res.status(401).json({ error: "Unauthorized (invalid session)" });
    }

    req.userId = user._id;
    next();
  } catch (err) {
    console.error("requireSession error:", err);
    res.status(401).json({ error: "Unauthorized" });
  }
}
