// Express backend that issues S3 presigned URLs and serves the static UI
// This file wires up a tiny REST API and a static frontend.
// The browser never uploads/downloads through our server; it talks directly to S3 using short-lived URLs.
const express = require('express'); // Express is the minimal HTTP server/framework we use
const cors = require('cors'); // CORS middleware allows the browser to call our API endpoints safely
const dotenv = require('dotenv'); // dotenv loads environment variables from a local .env file at startup
// Import the AWS SDK v3 S3 client and the specific commands we use
// ListObjectsV2Command = list files; PutObjectCommand = upload; GetObjectCommand = download; DeleteObjectCommand = delete
const { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner'); // Helper for creating presigned URLs for S3 operations
const mime = require('mime-types'); // Used to infer a Content-Type based on the filename when none is provided

// Load environment variables from .env (AWS creds, region, bucket, port)
// This looks for a file named ".env" in the project root and merges those values into process.env
// Required keys: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET; optional: PORT
dotenv.config();

const app = express(); // Create a new Express application instance
app.use(cors()); // Allow cross-origin requests (handy in dev; adjust if you host frontend elsewhere)
app.use(express.json()); // Parse incoming application/json request bodies into req.body
app.use(express.static('public')); // Serve the static frontend files (index.html, JS, CSS) from the ./public folder

// Validate required configuration early for better DX
const requiredEnv = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
console.error('Missing required env vars:', missing.join(', '));
}

// S3 v3 client (region must match your bucket's actual region)
const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucket = process.env.S3_BUCKET;

// Simple health check endpoint
// Useful for uptime checks and to confirm the server is reachable
// Returns a tiny JSON payload { ok: true }
app.get('/api/health', (req, res) => {
res.json({ ok: true });
});

// List objects in S3
// Optional query param "prefix" lets the UI mimic folders (e.g., photos/)
// We call S3's ListObjectsV2 API and map the results to a small JSON shape
app.get('/api/files', async (req, res) => {
try {
const prefix = req.query.prefix || ''; // read from URL e.g. /api/files?prefix=folder/
// Construct the AWS SDK command object with our bucket and optional Prefix
const command = new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix });
// Send the command via the S3 client; this performs the network call
const data = await s3.send(command);
// data.Contents is an array of object metadata; map to the fields our UI needs
const items = (data.Contents || []).map((o) => ({
key: o.Key,
size: o.Size,
lastModified: o.LastModified,
}));
res.json({ items }); // respond with JSON so the frontend can render the table
} catch (err) {
console.error(err); // log server-side for debugging
res.status(500).json({ error: 'Failed to list files' }); // generic error for client
}
});

// Generate a presigned URL for upload (HTTP PUT directly to S3)
// The client provides the desired object key and optional contentType
// We return a short-lived URL that authorizes a single PUT to that key
app.post('/api/upload-url', async (req, res) => {
try {
const { key, contentType } = req.body || {}; // JSON body parsed by express.json()
if (!key) return res.status(400).json({ error: 'key is required' }); // basic validation
// Determine the Content-Type header S3 should store; infer from file extension as fallback
const ct = contentType || mime.lookup(key) || 'application/octet-stream';
// Build the PutObject command describing the upload we want to allow
const putCmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: ct });
// Create a presigned URL that includes auth signature and expiry (seconds)
const url = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 }); // 5 minutes
res.json({ url, key, contentType: ct }); // client will PUT the file bytes to this URL
} catch (err) {
console.error(err);
res.status(500).json({ error: 'Failed to create upload URL' });
}
});

// Generate a presigned URL for download (HTTP GET directly from S3)
// The client passes ?key=...; we sign a GET for that key so the browser can fetch it
app.get('/api/download-url', async (req, res) => {
try {
const key = req.query.key; // read the object key from query string
if (!key) return res.status(400).json({ error: 'key is required' });
const getCmd = new GetObjectCommand({ Bucket: bucket, Key: key }); // describe the GET
const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 5 }); // sign with expiry
res.json({ url, key }); // client will open the URL to download the file
} catch (err) {
console.error(err);
res.status(500).json({ error: 'Failed to create download URL' });
}
});

// Delete an object from S3
// The client POSTs a JSON body with the object key to remove
app.delete('/api/files', async (req, res) => {
try {
const { key } = req.body || {};
if (!key) return res.status(400).json({ error: 'key is required' });
// Issue the DeleteObject command to S3 for the provided key
await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
res.json({ ok: true }); // signal success to the client
} catch (err) {
console.error(err);
res.status(500).json({ error: 'Failed to delete file' });
}
});

// Start HTTP server on configured port (default 3000)
// app.listen binds a TCP port and invokes the callback once listening
const port = process.env.PORT || 3000;
app.listen(port, () => {
console.log(`Server listening on http://localhost:${port}`);
});
