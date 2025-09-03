const openai = require('../utils/openaiClient');

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
      model: "gpt-4.1", // or gpt-5 if you have access
    });

    console.log("Assistant created:", assistant.id);
  } catch (err) {
    console.error("Error creating assistant:", err);
  }
}

createAssistant();
