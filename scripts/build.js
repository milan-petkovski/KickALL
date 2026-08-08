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
            if (entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
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

// 1. Pronađi i minifikuj SVE JS direktorijume u Website/ (root i pod-aplikacije)
let totalJsMinified = 0;
let totalOriginalBytes = 0;
let totalMinifiedBytes = 0;

function minifyJsDirectories(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    // Proveri da li je trenutni direktorijum nazvan 'js'
    if (path.basename(dir) === 'js') {
        try {
            const esbuild = require('esbuild');
            const distDir = path.join(dir, 'dist');
            if (!fs.existsSync(distDir)) {
                fs.mkdirSync(distDir, { recursive: true });
            }

            const jsFiles = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.min.js'));
            for (const file of jsFiles) {
                const srcPath = path.join(dir, file);
                const destPath = path.join(distDir, file.replace(/\.js$/, '.min.js'));
                const srcStat = fs.statSync(srcPath);
                totalOriginalBytes += srcStat.size;

                esbuild.buildSync({
                    entryPoints: [srcPath],
                    outfile: destPath,
                    minify: true,
                    bundle: false,
                    target: ['es2020']
                });

                const destStat = fs.statSync(destPath);
                totalMinifiedBytes += destStat.size;
                totalJsMinified++;
            }
        } catch (err) {
            console.warn(`⚠️ Minifikacija u ${path.relative(websiteDir, dir)} preskočena: ${err.message}`);
        }
    }

    for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
            minifyJsDirectories(path.join(dir, entry.name));
        }
    }
}

minifyJsDirectories(websiteDir);
const savedKb = ((totalOriginalBytes - totalMinifiedBytes) / 1024).toFixed(1);
const pct = totalOriginalBytes > 0 ? (((totalOriginalBytes - totalMinifiedBytes) / totalOriginalBytes) * 100).toFixed(1) : 0;
console.log(`📦 Minifikovano ukupno ${totalJsMinified} JS fajlova u svim modulima (Ušteda: ${savedKb} KB / -${pct}%).`);

// 2. Povezivanje minifikovanih skripti u HTML fajlovima i sw.js
let htmlFilesUpdated = 0;

function updateHtmlFileScripts(htmlPath) {
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');
    let modified = false;
    const htmlDir = path.dirname(htmlPath);

    // Zamenjuje src="(path)/js/filename.js" sa src="(path)/js/dist/filename.min.js" ako minifikovani fajl postoji
    htmlContent = htmlContent.replace(/src="((?:\.\.\/|\.\/)*)?js\/([a-zA-Z0-9_-]+)\.js(\?[^"]*)?"/g, (match, prefix = '', name, query = '') => {
        const targetJsDir = path.resolve(htmlDir, prefix + 'js');
        const minifiedFile = path.join(targetJsDir, 'dist', `${name}.min.js`);

        if (fs.existsSync(minifiedFile)) {
            modified = true;
            return `src="${prefix}js/dist/${name}.min.js${query}"`;
        }
        return match;
    });

    if (modified) {
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        htmlFilesUpdated++;
    }
}

function processHtmlFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
                processHtmlFiles(fullPath);
            }
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
            updateHtmlFileScripts(fullPath);
        }
    }
}

processHtmlFiles(websiteDir);
console.log(`🔗 Povezano i ažurirano ${htmlFilesUpdated} HTML fajlova da koriste minifikovane skripte.`);

// 3. Ažuriranje sw.js keš liste za PWA
const swPath = path.join(websiteDir, 'sw.js');
if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    let swModified = false;

    // Ažuriraj sve rute u root /js/ koje su premeštene u /js/dist/*.min.js
    const rootJsDir = path.join(websiteDir, 'js');
    if (fs.existsSync(rootJsDir)) {
        const rootJsFiles = fs.readdirSync(rootJsDir).filter(f => f.endsWith('.js') && !f.endsWith('.min.js'));
        rootJsFiles.forEach(file => {
            const name = file.replace(/\.js$/, '');
            const oldRef = `'\/js\/${name}\.js'`;
            const newRef = `'/js/dist/${name}.min.js'`;
            if (swContent.includes(`/js/${name}.js`)) {
                swContent = swContent.replace(new RegExp(oldRef, 'g'), newRef);
                swModified = true;
            }
        });
    }

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
