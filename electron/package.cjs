const fs = require('fs');
const path = require('path');
const packager = require('@electron/packager');

const projectRoot = path.join(__dirname, '..');
const stagingDir = path.join(projectRoot, '.desktop-build');
const releaseDir = path.join(projectRoot, 'release');

function resetDir(targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
}

function copyIntoStaging() {
  resetDir(stagingDir);
  fs.cpSync(path.join(projectRoot, 'dist'), path.join(stagingDir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'electron'), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, 'electron', 'main.cjs'),
    path.join(stagingDir, 'electron', 'main.cjs')
  );

  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );

  const desktopPackage = {
    name: rootPackage.name,
    version: rootPackage.version,
    productName: rootPackage.productName,
    description: rootPackage.description,
    author: rootPackage.author,
    main: 'electron/main.cjs',
  };

  fs.writeFileSync(
    path.join(stagingDir, 'package.json'),
    JSON.stringify(desktopPackage, null, 2)
  );
}

async function main() {
  copyIntoStaging();
  resetDir(releaseDir);

  await packager({
    dir: stagingDir,
    out: releaseDir,
    overwrite: true,
    platform: 'win32',
    arch: 'x64',
    asar: true,
    executableName: 'ShiftPlanner Pro',
    prune: true,
  });

  fs.rmSync(stagingDir, { recursive: true, force: true });
  console.log('Windows build ready in release/.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
