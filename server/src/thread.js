// server/src/thread.js
import openai from "../../server/src/utils/openaiClient.js";

async function main() {
  try {
    const thread = await openai.beta.threads.create();
    console.log("Full thread object returned by SDK:");
    console.log(JSON.stringify(thread, null, 2));
    console.log("Extracted thread.id:", thread.id);
  } catch (err) {
    console.error("Error creating thread:", err);
  }
}

main();
