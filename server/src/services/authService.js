// server/src/services/authService.js
import crypto from "crypto";
import User from "../schemas/userSchema.js";

// escape special regex chars
const reEscape = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const registerUser = async (username, email, password) => {
  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) throw new Error("User already exists");

  const newUser = new User({ username, email, password });
  await newUser.save();

  return { message: "User registered successfully" };
};

export const loginUser = async (identifier, password) => {
  if (!identifier?.trim()) throw new Error("Missing identifier");
  if (!password?.trim()) throw new Error("Missing password");

  // case-insensitive exact match for either field
  const exact = new RegExp(`^${reEscape(identifier.trim())}$`, "i");
  const user = await User.findOne({
    $or: [{ email: exact }, { username: exact }],
  });

  if (!user) throw new Error("User not found");
  if (user.password !== password) throw new Error("Invalid password");

  const sessionId = crypto.randomBytes(32).toString("hex");
  user.sessionId = sessionId;
  await user.save();

  return {
    sessionId,
    user: { id: user._id, username: user.username, email: user.email },
  };
};

export const logoutUser = async (sessionId) => {
  const user = await User.findOne({ sessionId });
  if (!user) throw new Error("Invalid session");

  user.sessionId = null;
  await user.save();

  return { message: "Logged out successfully" };
};
