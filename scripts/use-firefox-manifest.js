// 将 dist/manifest.json 替换为 Firefox 版 manifest（manifest-firefox.json）
// 用法: node scripts/use-firefox-manifest.js （在 npm run build 之后调用）
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distManifest = path.join(root, 'dist', 'manifest.json');
const firefoxManifest = path.join(root, 'manifest-firefox.json');

if (!fs.existsSync(firefoxManifest)) {
  console.error('manifest-firefox.json not found');
  process.exit(1);
}
fs.copyFileSync(firefoxManifest, distManifest);
console.log('dist/manifest.json replaced with Firefox manifest.');
