const { exec } = require('child_process');
const path = require('path');

console.log('🚀 Starting KickALL Website Optimization...\n');

// Run all optimization scripts
const scripts = [
  { name: 'Images', cmd: 'node build-images.js' },
  { name: 'CSS', cmd: 'node build-css.js' },
  { name: 'JavaScript', cmd: 'node build-js.js' }
];

async function runScript(script) {
  return new Promise((resolve, reject) => {
    console.log(`\n📦 Optimizing ${script.name}...`);
    exec(script.cmd, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ ${script.name} failed:`, error);
        reject(error);
      } else {
        console.log(stdout);
        if (stderr) console.error(stderr);
        resolve();
      }
    });
  });
}

async function main() {
  try {
    for (const script of scripts) {
      await runScript(script);
    }
    
    console.log('\n✨ All optimizations complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Update HTML files to use .min.css and .min.js');
    console.log('2. Update image references to use .webp files');
    console.log('3. Test the optimized version');
  } catch (error) {
    console.error('\n❌ Optimization failed:', error);
    process.exit(1);
  }
}

main();
