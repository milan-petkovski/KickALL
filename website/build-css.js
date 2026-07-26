const postcss = require('postcss');
const cssnano = require('cssnano');
const fs = require('fs');
const path = require('path');

const cssFiles = [
  'css/style.css',
  'css/dashboard.css'
];

async function minifyCSS() {
  console.log('🎨 Minifying CSS...');
  
  const processor = postcss([cssnano()]);
  
  for (const file of cssFiles) {
    const inputPath = path.join(__dirname, file);
    const outputPath = inputPath.replace('.css', '.min.css');
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${file} (not found)`);
      continue;
    }
    
    try {
      const css = fs.readFileSync(inputPath, 'utf8');
      const result = await processor.process(css, { from: inputPath });
      
      fs.writeFileSync(outputPath, result.css);
      
      const originalSize = css.length / 1024;
      const newSize = result.css.length / 1024;
      const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
      
      console.log(`✅ ${file}: ${originalSize.toFixed(1)}KB → ${newSize.toFixed(1)}KB (${savings}% saved)`);
    } catch (error) {
      console.error(`❌ Error minifying ${file}:`, error.message);
    }
  }
  
  console.log('✨ CSS minification complete!');
}

minifyCSS();
