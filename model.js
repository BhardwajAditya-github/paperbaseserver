import mongoose from "mongoose";

const ocrDataSchema = new mongoose.Schema(
  {
    title: String,
    file_name: String,
    college: String,
    type: String,
  },
  { timestamps: true }
);

// Add a text index on the 'file_name' field
ocrDataSchema.index({ file_name: 'text' });

const OCRData = mongoose.model('OCRData', ocrDataSchema);

export default OCRData;
