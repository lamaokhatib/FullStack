//src/cli/cli.js
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import fileHandler from '../utils/fileHandler.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter a file path: ', async (filePath) => {
  try {
    const columns = await fileHandler(filePath);
    console.log('\nDetected columns:\n', JSON.stringify(columns, null, 2));

    // Save the file into dbs/
    const dbsFolder = path.join(process.cwd(), 'src', 'dbs');
    if (!fs.existsSync(dbsFolder)) fs.mkdirSync(dbsFolder);
    const destPath = path.join(dbsFolder, path.basename(filePath));
    fs.copyFileSync(filePath, destPath);
    console.log(`\nFile saved to: ${destPath}`);
  } catch (err) {
    console.error('Error:', err.message);
  }

  rl.close();
});

