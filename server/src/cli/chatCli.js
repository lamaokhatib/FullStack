// server/src/cli/chatCli.js
import readline from "readline";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = process.env.API_BASE || "http://localhost:3000/api";
let threadId = null;

// === Upload File ===
async function uploadFile(filePath, prompt = "") {
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(filePath)]), filePath);
    if (prompt) form.append("prompt", prompt);
    if (threadId) form.append("threadId", threadId);

    const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
    const data = await res.json();

    if (data.threadId) threadId = data.threadId;

    console.log("✅ File uploaded:", data.file);
    console.log("📊 Columns detected:", JSON.stringify(data.columns, null, 2));
    if (data.openai) console.log("Bot>", data.openai);
  } catch (err) {
    console.error("Upload error:", err.message);
  }
}

// === Send Message ===
async function sendMessage(message) {
  try {
    const res = await fetch(`${API_BASE}/chat/flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId }),
    });
    const data = await res.json();

    if (data.threadId) threadId = data.threadId;

    console.log("Bot>", data.openai || JSON.stringify(data));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

// === Terminal Setup ===
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "You> ",
});

console.log("💬 Terminal Chat Interface");
console.log("Commands:");
console.log("  /upload <path> [prompt]   Upload a file (CSV, JSON, DB, SQL)");
console.log("  /exit                     Quit\n");

rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) return rl.prompt();

  if (input.toLowerCase() === "/exit") {
    rl.close();
    return;
  }

  // Handle /upload command
  if (input.startsWith("/upload ")) {
    const parts = input.split(" ");
    const filePath = parts[1];
    const prompt = parts.slice(2).join(" ");
    if (!fs.existsSync(filePath)) {
      console.log("❌ File not found:", filePath);
    } else {
      await uploadFile(filePath, prompt);
    }
    rl.prompt();
    return;
  }

  // Otherwise → treat as chat message
  await sendMessage(input);
  rl.prompt();
});
