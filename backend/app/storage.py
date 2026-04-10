from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from .config import settings


class LocalStorage:
    def __init__(self) -> None:
        self.root = Path(settings.storage_root)
        self.uploads = self.root / 'uploads'
        self.cleaned = self.root / 'cleaned'
        self.uploads.mkdir(parents=True, exist_ok=True)
        self.cleaned.mkdir(parents=True, exist_ok=True)

    def new_paper_id(self) -> str:
        return f'paper-{uuid4().hex[:12]}'

    def new_job_id(self) -> str:
        return f'job-{uuid4().hex[:12]}'

    def build_original_path(self, paper_id: str, suffix: str) -> Path:
        suffix = suffix if suffix.startswith('.') else f'.{suffix}'
        return self.uploads / f'{paper_id}{suffix}'

    def build_cleaned_path(self, paper_id: str) -> Path:
        return self.cleaned / f'{paper_id}-cleaned.png'

    async def save_upload(self, paper_id: str, file: UploadFile) -> Path:
        suffix = Path(file.filename or 'upload.png').suffix or '.png'
        target = self.build_original_path(paper_id, suffix)
        target.write_bytes(await file.read())
        return target

    def public_url(self, path: Path) -> str:
        rel = path.relative_to(self.root).as_posix()
        return f"{settings.public_base_url.rstrip('/')}/storage/{rel}"


# 根據設定選擇 storage backend
if settings.use_supabase:
    from .supabase_storage import SupabaseStorage
    storage = SupabaseStorage()
else:
    storage = LocalStorage()
