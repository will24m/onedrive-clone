## OneDrive Clone (S3-backed)

Minimal app to upload, list, download, and delete files in an S3 bucket via a simple Node/Express backend with presigned URLs and a static frontend.

### Prerequisites
- Node 18+
- An AWS account with an S3 bucket
- Programmatic credentials for an IAM user/role with S3 access (PutObject/GetObject/List/Delete)

### Setup
1. Copy `env.example` to `.env` and fill values:
   - `AWS_REGION`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `S3_BUCKET`
   - `PORT` (optional)
2. Install deps:
   - `npm install`
3. Run in dev:
   - `npm run dev`
   - Open `http://localhost:3000`

### Usage
- Use the UI to select a file and optional `prefix` (acts like a folder path e.g. `photos/`)
- Upload, list files, download via presigned link, and delete

### Sync a local folder (optional)
- Put files into a local directory and upload to S3 (one-shot):
  - `node sync/sync.js --dir "./my-folder" --prefix "backup/"`

Flags:
- `--dry` to print actions without uploading
- `--concurrency 5` to control parallel uploads

### Security Notes
- Never commit real AWS credentials. Use `.env` locally or AWS SSO/role-based auth.
- Consider using presigned POST for browser-only uploads if needed.

