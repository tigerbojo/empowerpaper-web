import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..config import settings
from ..image_cleanup import cleanup_exam_image
from ..job_store import job_store
from ..schemas import CleanJobResult, CleanPaperRequest, CleanPaperResponse, UploadPaperResponse
from ..storage import storage

router = APIRouter(prefix='/papers', tags=['papers'])

# Local mode 才用這個 in-memory index（Supabase mode 直接查 DB）
papers_index: dict[str, Path] = {}


def _build_local_clean_path(paper_id: str, mode: str, darkness: float = 1.0) -> Path:
    dk_suffix = '' if abs(darkness - 1.0) < 0.01 else f'-d{int(darkness * 100)}'
    suffix = ('cleaned' if mode == 'auto' else f'cleaned-{mode}') + dk_suffix
    return storage.cleaned / f'{paper_id}-{suffix}.png'


def _build_local_ocr_path(paper_id: str, mode: str) -> Path:
    suffix = 'ocr' if mode == 'auto' else f'ocr-{mode}'
    return storage.cleaned / f'{paper_id}-{suffix}.png'


@router.get('/history')
async def list_papers(limit: int = 50) -> dict:
    """歷史記錄：列出所有上傳過的考卷"""
    if not settings.use_supabase:
        return {'papers': [], 'message': 'history requires Supabase backend'}

    papers = storage.list_papers(limit=limit)
    items = []
    for p in papers:
        cleaned_paths = p.get('cleaned_paths') or {}
        # 找預設 darkness=1.0 的清理結果
        cleaned_path = cleaned_paths.get('1.0') or next(iter(cleaned_paths.values()), None)
        items.append({
            'paper_id': p['paper_id'],
            'original_url': storage.public_url(p['original_path']),
            'cleaned_url': storage.public_url(cleaned_path) if cleaned_path else None,
            'darkness': p.get('darkness', 1.0),
            'created_at': p.get('created_at'),
        })
    return {'papers': items}


@router.post('/upload', response_model=UploadPaperResponse)
async def upload_paper(file: UploadFile = File(...)) -> UploadPaperResponse:
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='只支援圖片格式上傳')

    paper_id = storage.new_paper_id()
    path_or_str = await storage.save_upload(paper_id, file)

    if settings.use_supabase:
        # Supabase: path_or_str 是 storage path (str)
        original_url = storage.public_url(path_or_str)
    else:
        # Local: path_or_str 是 Path
        papers_index[paper_id] = path_or_str
        original_url = storage.public_url(path_or_str)

    return UploadPaperResponse(
        paper_id=paper_id,
        original_image_url=original_url,
        status='uploaded',
    )


@router.post('/clean', response_model=CleanPaperResponse)
async def clean_paper(payload: CleanPaperRequest) -> CleanPaperResponse:
    """同步處理（適用於 Cloud Run）"""

    if settings.use_supabase:
        return await _clean_paper_supabase(payload)
    return await _clean_paper_local(payload)


async def _clean_paper_local(payload: CleanPaperRequest) -> CleanPaperResponse:
    if payload.paper_id not in papers_index:
        raise HTTPException(status_code=404, detail='找不到對應的 paperId')

    cleaned_path = _build_local_clean_path(payload.paper_id, payload.mode, payload.darkness)
    ocr_path = _build_local_ocr_path(payload.paper_id, payload.mode)

    if cleaned_path.exists():
        return CleanPaperResponse(
            paper_id=payload.paper_id,
            job_id='existing',
            status='completed',
            cleaned_image_url=storage.public_url(cleaned_path),
            ocr_image_url=storage.public_url(ocr_path) if ocr_path.exists() else None,
            processor='opencv',
            requested_mode=payload.mode,
        )

    try:
        original_path = papers_index[payload.paper_id]
        artifacts = cleanup_exam_image(
            original_path, cleaned_path, payload.mode, ocr_path, payload.darkness,
        )
        return CleanPaperResponse(
            paper_id=payload.paper_id,
            job_id='sync',
            status='completed',
            cleaned_image_url=storage.public_url(artifacts.cleaned_path),
            ocr_image_url=storage.public_url(artifacts.ocr_path) if artifacts.ocr_path else None,
            processor=artifacts.processor,
            requested_mode=payload.mode,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'清理失敗：{exc}')


async def _clean_paper_supabase(payload: CleanPaperRequest) -> CleanPaperResponse:
    """Supabase 版：先查 DB，若已有結果直接回傳；否則下載原圖→處理→上傳"""
    paper = storage.get_paper(payload.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail='找不到對應的 paperId')

    cleaned_path = storage.build_cleaned_path(payload.paper_id, payload.mode, payload.darkness)

    # 檢查是否已處理過此 darkness
    cleaned_paths = paper.get('cleaned_paths') or {}
    darkness_key = str(round(payload.darkness, 2))
    if darkness_key in cleaned_paths:
        return CleanPaperResponse(
            paper_id=payload.paper_id,
            job_id='existing',
            status='completed',
            cleaned_image_url=storage.public_url(cleaned_paths[darkness_key]),
            ocr_image_url=None,
            processor='opencv',
            requested_mode=payload.mode,
        )

    # 下載原圖到本地暫存
    try:
        original_local = storage.download_to_tmp(paper['original_path'])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'下載原圖失敗：{exc}')

    # 處理（輸出到本地暫存）
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_out:
        tmp_out_path = Path(tmp_out.name)

    try:
        artifacts = cleanup_exam_image(
            original_local, tmp_out_path, payload.mode, None, payload.darkness,
        )
        # 上傳結果到 Supabase
        cleaned_bytes = artifacts.cleaned_path.read_bytes()
        storage.upload_bytes(cleaned_path, cleaned_bytes, 'image/png')
        # 更新 papers table
        storage.update_paper_cleaned(payload.paper_id, payload.darkness, cleaned_path)

        return CleanPaperResponse(
            paper_id=payload.paper_id,
            job_id='sync',
            status='completed',
            cleaned_image_url=storage.public_url(cleaned_path),
            ocr_image_url=None,
            processor=artifacts.processor,
            requested_mode=payload.mode,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'清理失敗：{exc}')
    finally:
        tmp_out_path.unlink(missing_ok=True)


@router.get('/jobs/{job_id}', response_model=CleanJobResult)
async def get_job(job_id: str) -> CleanJobResult:
    state = job_store.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail='找不到對應的 jobId')

    return CleanJobResult(
        paper_id=state.paper_id,
        job_id=state.job_id,
        status=state.status,
        cleaned_image_url=state.cleaned_image_url,
        ocr_image_url=state.ocr_image_url,
        error=state.error,
        processor=state.processor,
        requested_mode=state.requested_mode,
    )
