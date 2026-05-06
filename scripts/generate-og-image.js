// Run with: node scripts/generate-og-image.js
// Requires: npm install sharp (already in most Next.js projects)
const fs = require("fs");
const path = require("path");

async function generateOgImage() {
  try {
    const sharp = require("sharp");
    const svgBuffer = fs.readFileSync(path.join(__dirname, "../public/og-image-source.svg"));
    await sharp(svgBuffer).png().toFile(path.join(__dirname, "../public/og-image.png"));
    console.log("✅ og-image.png generated at public/og-image.png");
  } catch (e) {
    console.error("sharp not available, copy og-image-source.svg → og-image.png manually or use @vercel/og");
    console.error(e.message);
  }
}
generateOgImage();
