"""
Supabase 版的 storage adapter
- 圖片存到 Supabase Storage（papers bucket）
- paper / crop metadata 存到 Postgres
"""

import logging
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from supabase import Client, create_client

from .config import settings

logger = logging.getLogger(__name__)


class SupabaseStorage:
    def __init__(self) -> None:
        self.client: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_key,
        )
        self.bucket = settings.supabase_bucket
        # 暫存目錄（cleanup 處理時 cv2 需要 local file）
        self.tmp_root = Path(tempfile.gettempdir()) / 'empowerpaper'
        self.tmp_root.mkdir(parents=True, exist_ok=True)

    # ── ID 生成 ─────────────────────────────────
    def new_paper_id(self) -> str:
        return f'paper-{uuid4().hex[:12]}'

    def new_job_id(self) -> str:
        return f'job-{uuid4().hex[:12]}'

    # ── 路徑處理 ────────────────────────────────
    def build_original_path(self, paper_id: str, suffix: str) -> str:
        suffix = suffix if suffix.startswith('.') else f'.{suffix}'
        return f'uploads/{paper_id}{suffix}'

    def build_cleaned_path(self, paper_id: str, mode: str = 'opencv', darkness: float = 1.0) -> str:
        dk_suffix = '' if abs(darkness - 1.0) < 0.01 else f'-d{int(darkness * 100)}'
        return f'cleaned/{paper_id}-cleaned-{mode}{dk_suffix}.png'

    # ── Storage 操作 ────────────────────────────
    async def save_upload(self, paper_id: str, file: UploadFile) -> str:
        """上傳檔案到 Supabase Storage，回傳 storage path"""
        suffix = Path(file.filename or 'upload.png').suffix or '.png'
        path = self.build_original_path(paper_id, suffix)
        content = await file.read()

        # Supabase 上傳
        self.client.storage.from_(self.bucket).upload(
            path=path,
            file=content,
            file_options={
                'content-type': file.content_type or 'image/png',
                'upsert': 'true',
            },
        )

        # 寫入 papers table
        self.client.table('papers').upsert({
            'paper_id': paper_id,
            'original_path': path,
        }).execute()

        return path

    def upload_bytes(self, path: str, content: bytes, content_type: str = 'image/png') -> str:
        """上傳任意 bytes，回傳 storage path"""
        self.client.storage.from_(self.bucket).upload(
            path=path,
            file=content,
            file_options={
                'content-type': content_type,
                'upsert': 'true',
            },
        )
        return path

    def public_url(self, path: str) -> str:
        """取得公開 URL（papers bucket 已設為 public）"""
        return self.client.storage.from_(self.bucket).get_public_url(path)

    def download_to_tmp(self, path: str) -> Path:
        """從 Supabase Storage 下載到本地暫存（給 cv2 處理用）"""
        local = self.tmp_root / path.replace('/', '_')
        local.parent.mkdir(parents=True, exist_ok=True)
        content = self.client.storage.from_(self.bucket).download(path)
        local.write_bytes(content)
        return local

    # ── Paper metadata ─────────────────────────
    def get_paper(self, paper_id: str) -> dict | None:
        """從 papers table 查詢"""
        result = self.client.table('papers').select('*').eq('paper_id', paper_id).limit(1).execute()
        return result.data[0] if result.data else None

    def update_paper_cleaned(self, paper_id: str, darkness: float, cleaned_path: str) -> None:
        """記錄某個 darkness 對應的清理結果"""
        paper = self.get_paper(paper_id)
        if not paper:
            return
        cleaned_paths = paper.get('cleaned_paths') or {}
        cleaned_paths[str(round(darkness, 2))] = cleaned_path
        self.client.table('papers').update({
            'cleaned_paths': cleaned_paths,
            'darkness': darkness,
        }).eq('paper_id', paper_id).execute()

    def list_papers(self, limit: int = 50) -> list[dict]:
        result = (
            self.client.table('papers')
            .select('*')
            .order('created_at', desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
