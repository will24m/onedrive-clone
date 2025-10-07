#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const fg = require('fast-glob');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');

dotenv.config();

function parseArgs() {
    const args = process.argv.slice(2);
    const out = { dir: '', prefix: '', dry: false, concurrency: 5 };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--dir') out.dir = args[++i];
        else if (a === '--prefix') out.prefix = args[++i] || '';
        else if (a === '--dry') out.dry = true;
        else if (a === '--concurrency') out.concurrency = parseInt(args[++i] || '5', 10);
    }
    if (!out.dir) {
        console.error('Usage: node sync/sync.js --dir "./folder" [--prefix "backup/"] [--dry] [--concurrency 5]');
        process.exit(1);
    }
    return out;
}

async function limitConcurrency(items, limit, worker) {
    const results = [];
    let idx = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        while (idx < items.length) {
            const current = idx++;
            results[current] = await worker(items[current]);
        }
    });
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

    const s3 = new S3Client({ region });

    const absDir = path.resolve(process.cwd(), dir);
    const entries = await fg(['**/*'], { cwd: absDir, onlyFiles: true, dot: false });
    if (entries.length === 0) {
        console.log('No files found.');
        return;
    }

    console.log(`Uploading ${entries.length} files to s3://${bucket}/${prefix || ''}`);

    await limitConcurrency(entries, concurrency, async (rel) => {
        const abs = path.join(absDir, rel);
        const data = fs.readFileSync(abs);
        const key = (prefix ? `${prefix.replace(/(^\/+)|(\/+?$)/g,'')}/` : '') + rel.replace(/\\/g, '/');
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

