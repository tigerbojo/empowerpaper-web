FROM python:3.13-slim

# 安裝系統依賴（OpenCV headless 不需要 GUI 但仍需要這幾個 lib）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先複製 requirements 安裝（利用 Docker layer cache）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製應用程式
COPY app ./app

# Railway 會把 PORT 環境變數注入
ENV PORT=8001
EXPOSE 8001

# 啟動 uvicorn，host 0.0.0.0 讓外部能連
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
