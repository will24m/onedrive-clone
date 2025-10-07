// @ts-nocheck
// This file is plain Node.js. Disable TypeScript checks in editors that infer TS on .js files.
// On Windows, run it with: node sync/sync.js --dir "./folder" [--prefix "path/"] [--dry]
const path = require('path'); // Node core: utilities for file system paths (join/resolve/etc.)
const fs = require('fs'); // Node core: file system read/write APIs
const dotenv = require('dotenv'); // Loads environment variables from .env
const fg = require('fast-glob'); // Fast file globbing library to enumerate files recursively
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'); // AWS SDK v3 S3 client + upload command
const mime = require('mime-types'); // Infer Content-Type from filename extensions

// Load .env for AWS creds/region/bucket
// Ensures process.env contains S3_BUCKET and AWS_REGION (and credentials)
dotenv.config();

// Basic CLI arg parsing for --dir, --prefix, --dry, --concurrency
// We manually iterate argv to keep dependencies minimal and behavior explicit
function parseArgs() {
const args = process.argv.slice(2); // skip "node" and script path
const out = { dir: '', prefix: '', dry: false, concurrency: 5 };
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir') out.dir = args[++i]; // next token is the directory path
    else if (a === '--prefix') out.prefix = args[++i] || ''; // optional S3 key prefix
    else if (a === '--dry') out.dry = true; // print actions without uploading
    else if (a === '--concurrency') out.concurrency = parseInt(args[++i] || '5', 10); // parallel uploads
}

if (!out.dir) {
    console.error('Usage: node sync/sync.js --dir "./folder" [--prefix "backup/"] [--dry] [--concurrency 5]');
    process.exit(1); // terminate with non-zero exit code to signal misuse
}
return out;
}

// Simple concurrency limiter to run up to `limit` async tasks in parallel
// Uses a shared index advanced synchronously in each runner loop
async function limitConcurrency(items, limit, worker) {
const results = new Array(items.length);
let nextIndex = 0;

async function run() {
  for (;;) {
    const i = nextIndex++;
    if (i >= items.length) break;
    results[i] = await worker(items[i]);
  }
}

const runners = Array.from({ length: Math.min(limit, items.length) }, run);
await Promise.all(runners);
return results;
}

async function main() {
const { dir, prefix, dry, concurrency } = parseArgs();
const bucket = process.env.S3_BUCKET;
const region = process.env.AWS_REGION;
if (!bucket || !region) {
    console.error('Missing S3_BUCKET or AWS_REGION in environment.');
    process.exit(1);
}

// S3 client for uploads; region must match the bucket's region to avoid redirects
const s3 = new S3Client({ region });

const absDir = path.resolve(process.cwd(), dir); // absolute path to the target directory
// Find all files recursively (globs relative to cwd=absDir); excludes dotfiles for simplicity
const entries = await fg(['**/*'], { cwd: absDir, onlyFiles: true, dot: false });
if (entries.length === 0) {
    console.log('No files found.');
    return;
}

console.log(`Uploading ${entries.length} files to s3://${bucket}/${prefix || ''}`);

await limitConcurrency(entries, concurrency, async (rel) => {
    const abs = path.join(absDir, rel);
    const data = fs.readFileSync(abs);
    const key =
      (prefix ? `${prefix.replace(/(^\/+)|(\/+?$)/g, '')}/` : '') +
      rel.split('\\').join('/');
    const contentType = mime.lookup(rel) || 'application/octet-stream';
  
    if (dry) {
      console.log(`[dry] PUT ${key} (${data.length} bytes)`);
      return;
    }
  
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
    console.log(`PUT ${key}`);
  });

console.log('Done.');
}

main().catch((e) => {
console.error(e);
process.exit(1);
});

