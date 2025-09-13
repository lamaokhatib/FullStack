import multer from "multer";
import path from "path";
import fs from "fs";

const uploadFolder = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype === "application/json" ||
    file.originalname.toLowerCase().endsWith(".json") ||
    file.originalname.toLowerCase().endsWith(".db") ||
    file.originalname.toLowerCase().endsWith(".sql") ||
    file.originalname.toLowerCase().endsWith(".csv")
  ) {
    cb(null, true);
  } else {
    cb(new Error("Only JSON, DB, SQL, or CSV files are allowed"), false);
  }
};

const uploadJson = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

export default uploadJson;
