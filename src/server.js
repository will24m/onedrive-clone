const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const mime = require('mime-types');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const requiredEnv = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
    console.error('Missing required env vars:', missing.join(', '));
}

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucket = process.env.S3_BUCKET;

app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

// List objects with optional prefix
app.get('/api/files', async (req, res) => {
    try {
        const prefix = req.query.prefix || '';
        const command = new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: undefined });
        const data = await s3.send(command);
        const items = (data.Contents || []).map((o) => ({
            key: o.Key,
            size: o.Size,
            lastModified: o.LastModified,
        }));
        res.json({ items });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list files' });
    }
});

// Get presigned URL for upload
app.post('/api/upload-url', async (req, res) => {
    try {
        const { key, contentType } = req.body || {};
        if (!key) return res.status(400).json({ error: 'key is required' });
        const ct = contentType || mime.lookup(key) || 'application/octet-stream';
        const putCmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: ct });
        const url = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 });
        res.json({ url, key, contentType: ct });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create upload URL' });
    }
});

// Get presigned URL for download
app.get('/api/download-url', async (req, res) => {
    try {
        const key = req.query.key;
        if (!key) return res.status(400).json({ error: 'key is required' });
        const getCmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 5 });
        res.json({ url, key });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create download URL' });
    }
});

// Delete object
app.delete('/api/files', async (req, res) => {
    try {
        const { key } = req.body || {};
        if (!key) return res.status(400).json({ error: 'key is required' });
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});

