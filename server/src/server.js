// server.js
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const { sendJsonAndTextToOpenAI } = require('./utils/sendJsonAndTextToOpenAI');

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fileHandler = require('./utils/fileHandler');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Multer setup (disk storage)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'server', 'src', 'dbs'); // or wherever you prefer
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// ⬇️ UPDATED: now reads req.body.prompt sent from the UI
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const filePath = req.file.path;
    const columns = await fileHandler(filePath);

    // read prompt from multipart field "prompt"
    const prompt = (typeof req.body?.prompt === 'string' ? req.body.prompt : '').trim();
    if (!prompt) {
      return res.status(400).json({
        error: 'Missing prompt. Send it as a form-data field named "prompt" along with the file.'
      });
    }

    // Send to OpenAI (schema + user prompt)
    const aiText = await sendJsonAndTextToOpenAI({
      jsonObject: columns,
      text: prompt,
      model: 'gpt-4o-mini' // or o3-mini if you prefer stronger reasoning
    });

    res.json({
      message: 'File uploaded and analyzed successfully',
      file: req.file.originalname,
      columns,
      openai: aiText
    });
  } catch (err) {
    console.error(err);
    const msg = err?.error?.message || err?.response?.data?.error?.message || err.message || 'Unknown error';
    res.status(500).json({ error: msg });
  }
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
