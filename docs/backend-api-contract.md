# EmpowerPaper Backend API Contract

## Base URL
- Local: `http://localhost:8000/api`

## 1. Upload Paper
`POST /papers/upload`

### Request
- `multipart/form-data`
- field: `file`

### Response
```json
{
  "paper_id": "paper-abc123def456",
  "original_image_url": "http://localhost:8000/storage/uploads/paper-abc123def456.png",
  "status": "uploaded"
}
```

## 2. Request Cleaning
`POST /papers/clean`

### Request
支援兩種欄位名稱：
```json
{
  "paperId": "paper-abc123def456",
  "mode": "basic"
}
```
或
```json
{
  "paper_id": "paper-abc123def456",
  "mode": "basic"
}
```

### Response
```json
{
  "paper_id": "paper-abc123def456",
  "job_id": "job-1234abcd5678",
  "status": "processing",
  "cleaned_image_url": null
}
```

## 3. Get Cleaning Job
`GET /papers/jobs/{job_id}`

### Response
```json
{
  "paper_id": "paper-abc123def456",
  "job_id": "job-1234abcd5678",
  "status": "completed",
  "cleaned_image_url": "http://localhost:8000/storage/cleaned/paper-abc123def456-cleaned.png",
  "error": null
}
```

## 4. Health Check
`GET /health`

### Response
```json
{
  "status": "ok",
  "service": "empowerpaper-api"
}
```
