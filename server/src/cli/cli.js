const readline = require('readline');
const fs = require('fs');
const path = require('path');
const fileHandler = require('../utils/fileHandler');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter a file path: ', async (filePath) => {
  try {
    const columns = await fileHandler(filePath);
    console.log('\nDetected columns:\n', JSON.stringify(columns, null, 2));

    // Save the file into dbs/
    const dbsFolder = path.join(__dirname, 'dbs');
    if (!fs.existsSync(dbsFolder)) fs.mkdirSync(dbsFolder);
    const destPath = path.join(dbsFolder, path.basename(filePath));
    fs.copyFileSync(filePath, destPath);
    console.log(`\nFile saved to: ${destPath}`);
  } catch (err) {
    console.error('Error:', err.message);
  }

  rl.close();
});
