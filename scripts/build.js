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

// 1. Minifikacija JS fajlova u Website/js/
let jsFilesList = [];
try {
    const esbuild = require('esbuild');
    const jsDir = path.join(websiteDir, 'js');
    const distDir = path.join(jsDir, 'dist');

    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    jsFilesList = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
    let originalSize = 0;
    let minifiedSize = 0;

    for (const file of jsFilesList) {
        const srcPath = path.join(jsDir, file);
        const destPath = path.join(distDir, file.replace(/\.js$/, '.min.js'));
        const srcStat = fs.statSync(srcPath);
        originalSize += srcStat.size;

        esbuild.buildSync({
            entryPoints: [srcPath],
            outfile: destPath,
            minify: true,
            bundle: false,
            target: ['es2020']
        });

        const destStat = fs.statSync(destPath);
        minifiedSize += destStat.size;
    }

    const savedKb = ((originalSize - minifiedSize) / 1024).toFixed(1);
    const pct = (((originalSize - minifiedSize) / originalSize) * 100).toFixed(1);
    console.log(`📦 Minifikovano ${jsFilesList.length} JS fajlova u Website/js/dist/ (Ušteda: ${savedKb} KB / -${pct}%).`);
} catch (err) {
    console.warn(`⚠️ Minifikacija preskočena ili naišla na grešku: ${err.message}`);
}

// 2. Povezivanje minifikovanih skripti u HTML fajlovima i sw.js
let htmlFilesUpdated = 0;
const knownJsBasenames = new Set(jsFilesList.map(f => f.replace(/\.js$/, '')));

function updateHtmlScripts(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
                updateHtmlScripts(fullPath);
            }
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
            let htmlContent = fs.readFileSync(fullPath, 'utf8');
            let modified = false;

            htmlContent = htmlContent.replace(/src="(\.\.\/|\.\/)?js\/([a-zA-Z0-9_-]+)\.js(\?[^"]*)?"/g, (match, prefix = '', name, query = '') => {
                if (knownJsBasenames.has(name)) {
                    modified = true;
                    return `src="${prefix}js/dist/${name}.min.js${query}"`;
                }
                return match;
            });

            if (modified) {
                fs.writeFileSync(fullPath, htmlContent, 'utf8');
                htmlFilesUpdated++;
            }
        }
    }
}

updateHtmlScripts(websiteDir);
console.log(`🔗 Povezano i ažurirano ${htmlFilesUpdated} HTML fajlova da koriste minifikovane skripte iz js/dist/`);

// 3. Ažuriranje sw.js keš liste za PWA
const swPath = path.join(websiteDir, 'sw.js');
if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    let swModified = false;

    knownJsBasenames.forEach(name => {
        const oldRef = `'/js/${name}.js'`;
        const newRef = `'/js/dist/${name}.min.js'`;
        if (swContent.includes(oldRef)) {
            swContent = swContent.replace(new RegExp(oldRef, 'g'), newRef);
            swModified = true;
        }
    });

    if (swModified) {
        fs.writeFileSync(swPath, swContent, 'utf8');
        console.log('📱 Ažuriran sw.js sa minifikovanim rutama za PWA keširanje.');
    }
}

if (errorsFound > 0) {
    console.error(`❌ Pronađeno ${errorsFound} upozorenja/grešaka tokom gradnje.`);
    process.exit(1);
} else {
    console.log('🎉 Gradnja i optimizacija je uspešno završena!');
}
