const sharp = require('sharp');
const postcss = require('postcss');
const cssnano = require('cssnano');
const terser = require('terser');
const fs = require('fs');
const path = require('path');

const kickotDir = path.join(__dirname, 'kickot');

async function optimizeKickot() {
  console.log('🚀 Optimizing Kickot folder...\n');
  
  // Optimize images
  console.log('🖼️  Optimizing Kickot images...');
  const images = ['kickot.png', 'logo.png'];
  
  for (const img of images) {
    const inputPath = path.join(kickotDir, 'assets', img);
    const outputPath = path.join(kickotDir, 'assets', img.replace('.png', '.webp'));
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${img} (not found)`);
      continue;
    }
    
    try {
      await sharp(inputPath)
        .resize(1200, 540, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(outputPath);
      
      const originalSize = fs.statSync(inputPath).size / 1024;
      const newSize = fs.statSync(outputPath).size / 1024;
      const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
      
      console.log(`✅ ${img}: ${originalSize.toFixed(1)}KB → ${newSize.toFixed(1)}KB (${savings}% saved)`);
    } catch (error) {
      console.error(`❌ Error optimizing ${img}:`, error.message);
    }
  }
  
  // Minify CSS
  console.log('\n🎨 Minifying Kickot CSS...');
  const cssProcessor = postcss([cssnano()]);
  const cssFiles = ['css/style.css', 'css/dashboard.css'];
  
  for (const file of cssFiles) {
    const inputPath = path.join(kickotDir, file);
    const outputPath = inputPath.replace('.css', '.min.css');
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${file} (not found)`);
      continue;
    }
    
    try {
      const css = fs.readFileSync(inputPath, 'utf8');
      const result = await cssProcessor.process(css, { from: inputPath });
      
      fs.writeFileSync(outputPath, result.css);
      
      const originalSize = css.length / 1024;
      const newSize = result.css.length / 1024;
      const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
      
      console.log(`✅ ${file}: ${originalSize.toFixed(1)}KB → ${newSize.toFixed(1)}KB (${savings}% saved)`);
    } catch (error) {
      console.error(`❌ Error minifying ${file}:`, error.message);
    }
  }
  
  // Minify JS
  console.log('\n⚡ Minifying Kickot JavaScript...');
  const jsFiles = ['js/app.js', 'js/dashboard.js'];
  
  for (const file of jsFiles) {
    const inputPath = path.join(kickotDir, file);
    const outputPath = inputPath.replace('.js', '.min.js');
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${file} (not found)`);
      continue;
    }
    
    try {
      const code = fs.readFileSync(inputPath, 'utf8');
      const result = await terser.minify(code, {
        compress: { drop_console: false, dead_code: true, unused: true },
        mangle: true,
        format: { comments: false }
      });
      
      if (result.error) throw result.error;
      
      fs.writeFileSync(outputPath, result.code);
      
      const originalSize = code.length / 1024;
      const newSize = result.code.length / 1024;
      const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
      
      console.log(`✅ ${file}: ${originalSize.toFixed(1)}KB → ${newSize.toFixed(1)}KB (${savings}% saved)`);
    } catch (error) {
      console.error(`❌ Error minifying ${file}:`, error.message);
    }
  }
  
  console.log('\n✨ Kickot optimization complete!');
}

optimizeKickot();
