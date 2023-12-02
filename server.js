import  express  from "express";
import multer from "multer";
import cors from 'cors';
import {google} from "googleapis";
// import apikeys from './apikey.json' assert { type: 'json' };
import fs from 'fs';
import bodyParser from "body-parser";
import mongoose from 'mongoose';
import OCRData from './model.js';
import path from "path";
import dotenv from 'dotenv';
dotenv.config();

const SCOPE = ["https://www.googleapis.com/auth/drive"];
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

async function authorize(){
    const jwtClient = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY,
      SCOPE
    );
  
    await jwtClient.authorize();
    return jwtClient;
  }

  async function uploadFile(authClient, file, metaData) {
    return new Promise((resolve, reject) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      const fileMetaData = {
        name: metaData.originalname,
        parents: [process.env.PARENT]
      };
  
      const media = {
        mimeType: file.mimetype,
        body: fs.createReadStream(file.path)
      };
  
      drive.files.create({
        resource: fileMetaData,
        media: media,
        fields: 'id'
      }, (error, createdFile) => {
        if (error) {
          console.error(error);
          return reject(error);
        }
        console.log(file)
        savetobase(metaData) 
        resolve(createdFile.data.id);
      });
    });
  }

  async function savetobase(metaData) {

      const ocrData = new OCRData({
        title: metaData.title,
        file_name: metaData.originalname,
        college: metaData.college,
        type: metaData.type,
      });
  
      try {
        await ocrData.save();
  
        // Clear the 'uploads' folder
        fs.readdir("./uploads/", (err, files) => {
          if (err) {
            console.error('Error reading directory:', err);
            return;
          }
  
          // Use forEach to remove each file in the 'uploads' folder
          files.forEach((file) => {
            const filePath = path.join("./uploads/", file);
            fs.unlink(filePath, (unlinkError) => {
              if (unlinkError) {
                console.error('Error deleting file:', unlinkError);
              }
            });
          });
          console.log('Uploads folder cleared');
        });
        console.log('OCR data saved to MongoDB');
      } catch (error) {
        console.error('Error saving OCR data to MongoDB:', error);
      }
    }

const app = express();
app.use(cors()); 
app.use(bodyParser.json()); 

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/'); // Specify the directory where files will be stored
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname); // Use the original filename
    },
  });

const upload = multer({ storage: storage });

app.get("/",(req,res)=>{
  res.send("<h1>Hello Sir</h1>");
})

app.post('/submit', async (req, res) => {
  const query = req.body.inputValue;
  const authClient = await authorize();

  console.log("query - " + query);
  try {
    const results = await OCRData.find(
      { $text: { $search: query } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .exec();

    const fileLinks = await Promise.all(results.map(async (result) => {
      const fileNames = Array.isArray(result.file_name) ? result.file_name : [result.file_name];
      const links = await Promise.all(fileNames.map(async (fileName) => {
        return {
          fileName,
          fileLink: await getFileLinkByName(authClient, fileName),
        };
      }));
      return { ...result._doc, links };
    }));

    res.status(200).send({
      success: true,
      message: "Data Retrieved",
      results: fileLinks
    });
  } catch (error) {
    console.error('Error performing search:', error);
    res.status(500).send({
      success: false,
      message: "Error in data retrieval",
      error
    });
  }
});

  async function getFileLinkByName(authClient, fileName) {
    return new Promise((resolve, reject) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      drive.files.list({
        q: `name='${fileName}'`,
        fields: 'files(id, name, webViewLink)',
      }, (error, response) => {
        if (error) {
          console.error(error);
          return reject(error);
        }
  
        const files = response.data.files;
        if (files && files.length > 0) {
          // Assuming there's only one file with the exact name
          const fileLink = files[0].webViewLink;
          resolve(fileLink);
        } else {
          console.log(`File with name '${fileName}' not found on Google Drive.`);
          resolve(null);
        }
      });
    });
  }

app.post('/upload', upload.single('file'), async (req, res) => {
    const authClient = await authorize();
    const metaData = {
      title: req.body.title || '',
      college: req.body.collegename || '',
      type: req.body.fileType || '',
      originalname: req.file.originalname || '',
    };
    const fileId = await uploadFile(authClient, req.file, metaData);
    res.json({ message: 'File uploaded successfully!',fileId });
  });

  const port = process.env.PORT || 3001;
app.listen(port,()=>{
    console.log("Server started on port 3001")
})

