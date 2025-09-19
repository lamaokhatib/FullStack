import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // plain text (NOT SECURE, only for learning)
    sessionId: { type: String, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
