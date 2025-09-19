//// authService.js
import crypto from "crypto";
import User from "../schemas/userSchema.js"; 

export const registerUser = async (username, email, password) => {
  const existing = await User.findOne({ email });
  if (existing) throw new Error("User already exists");

  const newUser = new User({ username, email, password });
  await newUser.save();

  return { message: "User registered successfully" };
};

export const loginUser = async (email, password) => {
  const user = await User.findOne({ email });
  if (!user) throw new Error("User not found");

  if (user.password !== password) throw new Error("Invalid password");

  const sessionId = crypto.randomBytes(32).toString("hex");
  user.sessionId = sessionId;
  await user.save();

  return {
    sessionId,
    user: { id: user._id, username: user.username, email: user.email }
  };
};

export const logoutUser = async (sessionId) => {
  const user = await User.findOne({ sessionId });
  if (!user) throw new Error("Invalid session");

  user.sessionId = null;
  await user.save();

  return { message: "Logged out successfully" };
};
