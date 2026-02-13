/**
 * Simplify parcel geometries using mapshaper.
 * Input: parcels-stripped.geojson → Output: public/parcels-web.geojson
 * 25% vertex retention with keep-shapes to preserve all parcels.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const input = path.join(__dirname, "..", "parcels-stripped.geojson");
const output = path.join(__dirname, "..", "public", "parcels-web.geojson");

if (!fs.existsSync(input)) {
  console.error(`Input not found: ${input}`);
  console.error("Run 'python scripts/strip_fields.py' first.");
  process.exit(1);
}

const mapshaper = path.join(__dirname, "..", "node_modules", ".bin", "mapshaper");

const inputSize = (fs.statSync(input).size / 1e6).toFixed(0);
console.log(`Input: ${inputSize} MB`);
console.log("Simplifying with 10% vertex retention...");

execSync(
  `"${mapshaper}" "${input}" -simplify 10% keep-shapes -o "${output}" format=geojson`,
  { stdio: "inherit", maxBuffer: 1024 * 1024 * 512 }
);

const outputSize = (fs.statSync(output).size / 1e6).toFixed(0);
console.log(`\nOutput: ${outputSize} MB → ${output}`);
