const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const cargo = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
const tauri = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = {
  package: packageJson.version,
  packageLock: packageLock.packages?.[""].version,
  cargo: cargoVersion,
  tauri: tauri.version,
};
const uniqueVersions = new Set(Object.values(versions));

if (!cargoVersion || uniqueVersions.size !== 1) {
  console.error("版本号不一致:", versions);
  process.exit(1);
}

if (process.argv.includes("--print")) {
  process.stdout.write(`${cargoVersion}\n`);
}
