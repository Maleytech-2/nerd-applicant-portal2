const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const PRIVATE_STORAGE_ROOT = path.resolve(process.env.PRIVATE_STORAGE_ROOT || path.join(__dirname, "..", "..", "storage", "private"));

function getReceiptMagicType(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) return "application/pdf";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  return null;
}

function createReceiptHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function storePrivateReceipt({ applicantId, buffer, originalFilename }) {
  const detectedType = getReceiptMagicType(buffer);
  if (!detectedType) throw new Error("The receipt must be a valid PDF, JPEG, or PNG file.");

  await fs.mkdir(PRIVATE_STORAGE_ROOT, { recursive: true, mode: 0o700 });
  const applicantDirectory = path.join(PRIVATE_STORAGE_ROOT, "receipts", String(applicantId));
  await fs.mkdir(applicantDirectory, { recursive: true, mode: 0o700 });

  const extension = detectedType === "application/pdf" ? "pdf" : detectedType === "image/png" ? "png" : "jpg";
  const storedFilename = `${crypto.randomUUID()}.${extension}`;
  const absolutePath = path.join(applicantDirectory, storedFilename);
  await fs.writeFile(absolutePath, buffer, { flag: "wx", mode: 0o600 });

  return {
    absolutePath,
    relativePath: path.relative(PRIVATE_STORAGE_ROOT, absolutePath).split(path.sep).join("/"),
    storedFilename,
    originalFilename: path.basename(originalFilename).slice(0, 255),
    mimeType: detectedType,
    fileSize: buffer.length,
  };
}

async function removeStoredFile(relativePath) {
  if (!relativePath) return;
  const absolutePath = path.resolve(PRIVATE_STORAGE_ROOT, relativePath);
  if (!absolutePath.startsWith(`${PRIVATE_STORAGE_ROOT}${path.sep}`)) return;
  await fs.unlink(absolutePath).catch(() => {});
}

module.exports = {
  PRIVATE_STORAGE_ROOT,
  createReceiptHash,
  getReceiptMagicType,
  storePrivateReceipt,
  removeStoredFile,
};
