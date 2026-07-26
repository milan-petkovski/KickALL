const terser = require('terser');
const fs = require('fs');
const path = require('path');

const jsFiles = [
  'js/app.js',
  'js/dashboard.js'
];

async function minifyJS() {
  console.log('⚡ Minifying JavaScript...');
  
  for (const file of jsFiles) {
    const inputPath = path.join(__dirname, file);
    const outputPath = inputPath.replace('.js', '.min.js');
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${file} (not found)`);
      continue;
    }
    
    try {
      const code = fs.readFileSync(inputPath, 'utf8');
      const result = await terser.minify(code, {
        compress: {
          drop_console: false, // Keep console for debugging
          dead_code: true,
          unused: true
        },
        mangle: true,
        format: {
          comments: false
        }
      });
      
      if (result.error) {
        throw result.error;
      }
      
      fs.writeFileSync(outputPath, result.code);
      
      const originalSize = code.length / 1024;
      const newSize = result.code.length / 1024;
      const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
      
      console.log(`✅ ${file}: ${originalSize.toFixed(1)}KB → ${newSize.toFixed(1)}KB (${savings}% saved)`);
    } catch (error) {
      console.error(`❌ Error minifying ${file}:`, error.message);
    }
  }
  
  console.log('✨ JavaScript minification complete!');
}

minifyJS();
