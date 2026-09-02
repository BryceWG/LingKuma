// 将 dist/ 打包为 Firefox 可用的 zip（AMO 签名/临时加载格式）
// 用法: npm run build:firefox && node scripts/pack-firefox.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const outFile = path.join(root, 'lingkuma-firefox.zip');

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json missing — run `npm run build:firefox` first.');
  process.exit(1);
}

// manifest 必须是 Firefox 版（含 browser_specific_settings.gecko）
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
if (!manifest.browser_specific_settings || !manifest.browser_specific_settings.gecko) {
  console.error('WARNING: dist/manifest.json does not contain browser_specific_settings.gecko — this is not the Firefox manifest. Run `npm run build:firefox`.');
  process.exit(1);
}

if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

// 递归收集 dist 下所有文件（相对路径，保证 manifest.json 位于压缩包根目录）
function walk(dir, base = '') {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      entries.push(...walk(full, rel));
    } else {
      entries.push(rel);
    }
  }
  return entries;
}

// 优先使用系统 zip；不可用时回退到 python zipfile
const hasZip = spawnSync('zip', ['-v']).status === 0;
if (hasZip) {
  const r = spawnSync('zip', ['-qr', outFile, '.'], { cwd: dist, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('zip command failed');
    process.exit(1);
  }
} else {
  const files = walk(dist);
  const py = `import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sys.argv[2:]:
        z.write(f, f)
`;
  const r = spawnSync('python3', ['-c', py, outFile, ...files], { cwd: dist, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('python zipfile fallback failed');
    process.exit(1);
  }
}

const size = fs.statSync(outFile).size;
console.log(`Packed: ${outFile} (${(size / 1024 / 1024).toFixed(2)} MB)`);
