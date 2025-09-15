//src/cli/createAssistant.js
import openai from '../utils/openaiClient.js';

async function createAssistant() {
  try {
    const assistant = await openai.beta.assistants.create({
      name: "SQL Generator",
      instructions: `
You are an SQL query generator.
Input will contain:
1) A database schema in JSON...
(rules here, same as your system prompt)
`,
      model: "gpt-4o-mini" // unified with the rest of your app
    });

    console.log("Assistant created:", assistant.id);
  } catch (err) {
    console.error("Error creating assistant:", err);
  }
}

createAssistant();

