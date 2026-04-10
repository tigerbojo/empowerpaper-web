from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes.health import router as health_router
from .routes.papers import router as papers_router

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(health_router, prefix='/api')
app.include_router(papers_router, prefix='/api')

# Local storage 才掛 /storage 靜態檔（Supabase mode 圖片走 Supabase 公開 URL）
if not settings.use_supabase:
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    app.mount('/storage', StaticFiles(directory=str(settings.storage_root)), name='storage')
