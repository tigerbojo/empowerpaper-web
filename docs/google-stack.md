# Google Stack Notes

## 前端
- React 18 + Vite
- Tailwind CSS
- Zustand
- TanStack Query
- Firebase Web SDK

## 後端
- FastAPI 部署到 Cloud Run
- 透過 REST API 提供上傳、去筆跡、裁切、組卷與 PDF 匯出

## Google 生態建議
- Auth: Firebase Authentication
- Database: Firestore（第一版）
- Storage: Google Cloud Storage
- OCR: Google Cloud Vision API
- Runtime: Cloud Run

## 建議的資料流
1. 前端上傳圖片到 FastAPI
2. FastAPI 寫入 GCS 並回傳 paper id
3. 背景任務做 OpenCV 去筆跡 / 拉平
4. OCR 由 Cloud Vision API 執行
5. 前端在 Edit 頁裁切錯題，送後端做標籤分類
6. Generate 頁將挑選題目組成 A4 預覽與 PDF

## 環境變數
請參考 `.env.example`。
