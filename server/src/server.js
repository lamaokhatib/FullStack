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
const fileHandler = require('./utils/fileHandler'); // <-- moved under server/src/utils (adjust if needed)

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Multer setup (disk storage in ./server/src/dbs)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'server', 'src', 'dbs');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// Your existing endpoint (unchanged)
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const filePath = req.file.path;
    const columns = await fileHandler(filePath); // returns your parsed schema/columns
    
    
// needs to be changed so it takes the user prompt as an input from ui - front end 
    const userPrompt = `
Schema JSON from uploaded file "${req.file.originalname}". 
return all likes of user with id = 1  
.
`.trim();

    // Send automatically to OpenAI
    const aiText = await sendJsonAndTextToOpenAI({
      jsonObject: columns,
      text: userPrompt,
      model: 'gpt-4o-mini'
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

// NEW: mount AI routes
app.use('/api/ai', require('./routers/ai.router'));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
