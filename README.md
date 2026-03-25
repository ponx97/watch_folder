# Claims Scanner Folder Watcher

A desktop application that automatically monitors a folder for scanned claim documents, uploads them via SFTP, and creates workflow records in your claims management system.

## 🚀 Quick Start

### 1. Set Up PostgreSQL & SFTP

1. **Set Up File Storage**:
   - Configure a folder on your VPS or SFTP server
   - Gather your host, username, password, and port details

2. **Set Up Database**:
   - Connect to your standard PostgreSQL database via pgAdmin or psql
   - Execute the contents of `database-schema.sql` to create the initial tables

### 2. Set Up API Server

1. **Install API Dependencies**:
   ```bash
   npm install --package-lock-only  # Use the api-package.json
   # Or manually install:
   npm install express cors pg dotenv nodemon
   ```

2. **Configure API Environment**:
   - Copy your `.env.api` file or create a new one for the API
   - Ensure it has your standard Postgres `DATABASE_URL`

3. **Start API Server**:
   ```bash
   node api-server.js
   # Or for development:
   npm run dev  # (if using api-package.json)
   ```

   The API will run on `http://localhost:3000`

### 3. Set Up Desktop Application

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   - The `.env` file needs to be configured with your SFTP credentials (`SFTP_HOST`, etc)
   - Update `API_URL` if your API is running on a different port

3. **Replace Icons** (Optional):
   - Replace placeholder files in `src/assets/` with actual icons:
     - `icon.png` (512x512)
     - `icon.ico` (Windows)
     - `icon.icns` (macOS)

4. **Run the Application**:
   ```bash
   npm run dev
   ```

## 📋 How It Works

1. **File Detection**: Monitors `C:\ScannedClaims\` for new files
2. **Validation**: Checks file size, type, and extracts barcode from filename
3. **Upload**: Sends files to the VPS via SFTP
4. **Database**: Creates records in your database via the API
5. **Organization**: Moves processed files to subfolders

### Supported File Types
- TIFF (.tiff, .tif)
- PDF (.pdf)
- JPEG (.jpg, .jpeg)
- PNG (.png)

### Barcode Extraction
Files should be named with barcodes like:
- `BC001234.pdf`
- `BC-001234.tiff`
- `BC_001234.jpg`

## 🛠 Development

### Project Structure
```
/
├── src/
│   ├── main.js              # Electron main process
│   ├── preload.js           # IPC bridge
│   ├── renderer/
│   │   ├── index.html       # UI
│   │   ├── styles.css       # Styles
│   │   └── app.js           # Frontend logic
│   └── services/            # Backend services
├── api-server.js            # Express API
├── database-schema.sql      # Database setup
└── package.json
```

### Building for Production
```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux

# All platforms
npm run build
```

## 🔧 Configuration

### Environment Variables
- `SFTP_HOST`: Your SFTP server URL or IP
- `SFTP_USERNAME`: Your SFTP username
- `SFTP_PASSWORD`: Your SFTP password
- `API_URL`: Your API server URL
- `WATCHED_FOLDER`: Folder to monitor
- `UPLOAD_USER`: Identifier for uploads
- `LOG_LEVEL`: Logging level (info, warn, error)

### In-App Settings
- Watched folder path
- Upload retry attempts
- File size limits
- Auto-start behavior

## 📊 API Endpoints

### POST /api/documents/upload
Creates a document record and workflow entry.

**Request Body**:
```json
{
  "file_name": "BC001234",
  "original_file_name": "BC001234.pdf",
  "file_type": "pdf",
  "file_size_bytes": 1024000,
  "mime_type": "application/pdf",
  "storage_bucket": "claim-documents",
  "storage_path": "dmg-bin/2024/01/BC001234.pdf",
  "storage_url": "https://...",
  "barcode": "BC001234",
  "batch_id": null,
  "scan_date": "2024-01-15T10:30:00.000Z",
  "uploaded_by": "scanner_app",
  "status": "dmg_bin"
}
```

**Response**:
```json
{
  "success": true,
  "documentId": "uuid",
  "workflowId": "uuid"
}
```

## 🐛 Troubleshooting

### Common Issues
1. **"Cannot find module 'electron'"**: Install Electron globally or use `npx electron`
2. **API connection failed**: Ensure API server is running on correct port
3. **SFTP upload failed**: Check server host, credentials, and path permissions
4. **File not detected**: Check folder permissions and file types

### Logs
Application logs are stored in:
- Windows: `%APPDATA%/claims-scanner-app/logs/`
- macOS: `~/Library/Application Support/claims-scanner-app/logs/`
- Linux: `~/.config/claims-scanner-app/logs/`

## 📝 License

MIT License - feel free to use and modify as needed.