// server/src/controllers/authController.js
import {
  registerUser,
  loginUser,
  logoutUser,
} from "../services/authService.js";

// Helper: read sessionId from body or Authorization header
const getSessionId = (req) => {
  if (req.body?.sessionId) return req.body.sessionId;
  const auth = req.headers?.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
};

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "username, email and password are required" });
    }
    const result = await registerUser(username, email, password);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || "Registration failed" });
  }
};

export const login = async (req, res) => {
  try {
    // Accept either { identifier, password } or legacy { email, password } / { username, password }
    const {
      identifier: rawIdentifier,
      email,
      username,
      password,
    } = req.body || {};
    const identifier = rawIdentifier || email || username;

    if (!identifier || !password) {
      return res
        .status(400)
        .json({
          error: "identifier (email or username) and password are required",
        });
    }

    // authService.loginUser expects (identifier, password)
    const result = await loginUser(identifier, password);
    res.json(result); // { sessionId, user: { id, username, email } }
  } catch (err) {
    res.status(400).json({ error: err.message || "Login failed" });
  }
};

export const logout = async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    const result = await logoutUser(sessionId);
    res.json(result); // { message: "Logged out successfully" }
  } catch (err) {
    res.status(400).json({ error: err.message || "Logout failed" });
  }
};
