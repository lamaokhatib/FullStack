const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fileHandler = require('./utils/fileHandler');
const app = express();
const port = 3000;

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'dbs');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const filePath = req.file.path;
    const columns = await fileHandler(filePath);
    res.json({
      message: 'File uploaded and analyzed successfully',
      file: req.file.originalname,
      columns
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
