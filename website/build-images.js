const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
const images = [
  'kickall.png',
  'kickot.png',
  'kickaj.png',
  'kickan.png',
  'kickov.png',
  'logo.png'
];

async function optimizeImages() {
  console.log('🖼️  Optimizing images...');
  
  for (const img of images) {
    const inputPath = path.join(assetsDir, img);
    const outputPath = path.join(assetsDir, img.replace('.png', '.webp'));
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${img} (not found)`);
      continue;
    }
    
    try {
      await sharp(inputPath)
        .resize(1200, 540, { fit: 'cover' }) // Resize to reasonable dimensions
        .webp({ quality: 80 }) // Convert to WebP with 80% quality
        .toFile(outputPath);
      
      const originalSize = fs.statSync(inputPath).size / 1024;
      const newSize = fs.statSync(outputPath).size / 1024;
      const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
      
      console.log(`✅ ${img}: ${originalSize.toFixed(1)}KB → ${newSize.toFixed(1)}KB (${savings}% saved)`);
    } catch (error) {
      console.error(`❌ Error optimizing ${img}:`, error.message);
    }
  }
  
  console.log('✨ Image optimization complete!');
}

optimizeImages();
