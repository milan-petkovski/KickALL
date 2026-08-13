const fs = require('fs');
const path = require('path');

console.log('Pokrećem statičku verifikaciju resursa za KickALL sajt...');

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
                        console.warn(`Upozorenje: Moguće oštećenje karaktera u fajlu: ${path.relative(rootDir, fullPath)}`);
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
                    console.error(`Greška pri čitanju fajla ${fullPath}: ${err.message}`);
                    errorsFound++;
                }
            }
        }
    }
}

walkDir(websiteDir);

console.log(`Pregledano ${totalFilesChecked} resursnih fajlova u Website direktorijumu.`);
console.log(`Detektovano ${lazyImagesChecked} slika sa lazy-loading podešavanjem.`);

// Proveri da li postoje dashboard HTML fajlovi
let dashboardsOk = 0;
for (const d of dashboards) {
    const htmlPath = path.join(websiteDir, d, 'dashboard.html');
    if (fs.existsSync(htmlPath)) {
        dashboardsOk++;
    } else {
        console.warn(`Upozorenje: Nije pronađen dashboard.html za modul: ${d}`);
        errorsFound++;
    }
}
console.log(`Dashboard varijante verifikovane (${dashboardsOk}/${dashboards.length}): ${dashboards.join(', ')}`);

if (errorsFound > 0) {
    console.error(`Pronađeno ${errorsFound} upozorenja/grešaka tokom verifikacije.`);
    process.exit(1);
} else {
    console.log('Verifikacija je uspešno završena. Nema potrebe za build korakom - svi JS fajlovi se koriste direktno.');
}
