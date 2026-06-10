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
支援 `paperId` / `paper_id` 兩種欄位名稱。v11 起新增互動式擦除欄位：
```json
{
  "paper_id": "paper-abc123def456",
  "mode": "opencv",
  "darkness": 1.0,
  "include_components": true,
  "keep_ids": [12, 87],
  "erase_ids": [340]
}
```
- `include_components`: 回傳元件清單（智慧擦除 UI 用）
- `keep_ids`: 使用者「還原」的元件（覆寫自動擦除判定）
- `erase_ids`: 使用者「強制擦除」的元件
- 元件 id 是 OpenCV connected component label，同一張圖 deterministic，跨請求穩定
- 黑度（darkness）由前端 LUT 即時套用，後端一律只算 darkness=1.0 的基準圖

### Response
```json
{
  "paper_id": "paper-abc123def456",
  "job_id": "sync",
  "status": "completed",
  "cleaned_image_url": "...png",
  "ocr_image_url": "...png",
  "processor": "opencv",
  "image_width": 2200,
  "image_height": 1553,
  "components": [
    { "id": 12, "x": 100, "y": 240, "w": 56, "h": 22, "erased": true, "kind": "removed" }
  ]
}
```
- `kind`: `removed`（自動判手寫）/ `forced`（使用者強制擦）/ `restored`（使用者救回）
  / `candidate`（疑似手寫但保留）/ `ink`（一般墨水，可被使用者點擊強制擦）
- 座標為 cleaned image 像素座標
- 有覆寫（keep/erase）時結果以 `-ov<hash>` 後綴另存，不污染基準 cache；
  元件清單存在 `<cleaned>.json` sidecar，cache hit 直接回讀

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
