// services/uploadService.js
import fileHandler from "../utils/fileHandler.js";
import { sendJsonAndTextToOpenAI } from "../utils/sendJsonAndTextToOpenAI.js";

export const processUploadAndAnalyze = async (filePath, prompt) => {
  if (!filePath) throw new Error("No file uploaded");
  if (!prompt?.trim()) throw new Error("Missing prompt");

  // Extract schema/columns from file
  const columns = await fileHandler(filePath);

  // Send JSON + prompt to OpenAI
  const aiText = await sendJsonAndTextToOpenAI({
    jsonObject: columns,
    text: prompt,
    model: "gpt-4o-mini",
  });

  return { columns, aiText };
};
