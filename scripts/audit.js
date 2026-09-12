const { execSync } = require('child_process');

// npm 12 ugnježdeni poziv nasleđuje npm_config_allow_scripts iz korisničkog .npmrc što izaziva EALLOWSCRIPTS
const env = { ...process.env };
delete env.npm_config_allow_scripts;

try {
    execSync('npm audit --audit-level=high', { stdio: 'inherit', env });
} catch (err) {
    process.exit(err.status || 1);
}
