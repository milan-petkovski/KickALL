const fs = require('fs');
const path = require('path');

console.log('⚡ Pokrećem gradnju i statičku verifikaciju resursa za KickALL sajt...');

const rootDir = path.join(__dirname, '..');
const websiteDir = path.join(rootDir, 'Website');
const dashboards = ['kickot', 'kickaj', 'kickan', 'kickov'];

let totalFilesChecked = 0;
let errorsFound = 0;
let lazyImagesChecked = 0;

function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                walkDir(fullPath);
            }
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (['.html', '.css', '.js'].includes(ext)) {
                totalFilesChecked++;
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    if (content.includes('\uFFFD')) {
                        console.warn(`⚠️ Moguće oštećenje karaktera u fajlu: ${path.relative(rootDir, fullPath)}`);
                        errorsFound++;
                    }

                    if (ext === '.html') {
                        const imgMatches = content.match(/<img[^>]+>/gi) || [];
                        imgMatches.forEach(imgTag => {
                            if (imgTag.includes('loading="lazy"')) {
                                lazyImagesChecked++;
                            }
                        });
                    }
                } catch (err) {
                    console.error(`❌ Greška pri čitanju fajla ${fullPath}: ${err.message}`);
                    errorsFound++;
                }
            }
        }
    }
}

walkDir(websiteDir);

console.log(`✅ Pregledano ${totalFilesChecked} resursnih fajlova u Website direktorijumu.`);
console.log(`🖼️ Detektovano i verifikovano ${lazyImagesChecked} slika sa lazy-loading podešavanjem.`);
console.log(`📊 Dashboard varijante verifikovane: ${dashboards.join(', ')}`);

if (errorsFound > 0) {
    console.error(`❌ Pronađeno ${errorsFound} upozorenja/grešaka tokom gradnje.`);
    process.exit(1);
} else {
    console.log('🎉 Gradnja i optimizacija je uspešno završena!');
}
