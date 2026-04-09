# EmpowerPaper Backend

第一版後端採用 FastAPI + OpenCV，先提供本機可用的試卷上傳與去痕跡流程。

## 功能
- `POST /api/papers/upload`：上傳原始圖片並建立 `paperId`
- `POST /api/papers/clean`：建立去痕跡背景任務並回傳 `jobId`
- `GET /api/papers/jobs/{job_id}`：查詢清理任務狀態與 `cleanedImageUrl`
- `GET /api/health`：健康檢查
- `GET /storage/...`：本機靜態圖片檔案

## 本機啟動
```powershell
cd H:\dev\empowerpaper-web\backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 環境變數
- `EMPOWERPAPER_STORAGE_ROOT`：本機檔案儲存根目錄，預設 `backend/data`
- `EMPOWERPAPER_PUBLIC_BASE_URL`：對外回傳圖片 URL 的基底，預設 `http://localhost:8000`
- `EMPOWERPAPER_ALLOWED_ORIGINS`：允許的前端來源，預設包含 `http://localhost:5173`

## 說明
這一版先用 OpenCV 做穩定清理：
- 自動縮放
- 灰階化
- 光照校正
- 降噪
- 自適應二值化
- 基礎 deskew

AI 深度去痕跡會留在下一階段，以同一條 `clean` job 介面擴充。
