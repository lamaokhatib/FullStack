/// authController.js
import { registerUser, loginUser, logoutUser } from "../services/authService.js";

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const result = await registerUser(username, email, password);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const logout = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const result = await logoutUser(sessionId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
