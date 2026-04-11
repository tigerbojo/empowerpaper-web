import tempfile
from pathlib import Path

import cv2
from fastapi import APIRouter, File, HTTPException, UploadFile

from ..config import settings
from ..document_warp import detect_document_corners, warp_document
from ..image_cleanup import cleanup_exam_image
from ..job_store import job_store
from ..llm_vision import OllamaProvider, GeminiProvider, get_provider
from ..schemas import (
    CleanJobResult, CleanPaperRequest, CleanPaperResponse,
    Corner, DetectCornersResponse, DetectQuestionsResponse, QuestionBoxOut,
    UploadPaperResponse, WarpPaperRequest, WarpPaperResponse,
)
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


def _get_paper_original_local(paper_id: str) -> Path:
    """取得原圖本地路徑（Supabase mode 會先下載到 tmp）"""
    if settings.use_supabase:
        paper = storage.get_paper(paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail='找不到對應的 paperId')
        return storage.download_to_tmp(paper['original_path'])
    else:
        if paper_id not in papers_index:
            raise HTTPException(status_code=404, detail='找不到對應的 paperId')
        return papers_index[paper_id]


@router.get('/{paper_id}/detect-corners', response_model=DetectCornersResponse)
async def detect_corners(paper_id: str) -> DetectCornersResponse:
    """自動偵測文件四邊形角點"""
    import numpy as np
    local_path = _get_paper_original_local(paper_id)
    corners = detect_document_corners(local_path)

    img = cv2.imdecode(
        np.frombuffer(local_path.read_bytes(), dtype=np.uint8),
        cv2.IMREAD_COLOR,
    )
    h, w = img.shape[:2]

    return DetectCornersResponse(
        paper_id=paper_id,
        image_width=w,
        image_height=h,
        corners=[Corner(x=x, y=y) for x, y in corners],
    )


@router.post('/warp', response_model=WarpPaperResponse)
async def warp_paper(payload: WarpPaperRequest) -> WarpPaperResponse:
    """
    根據 4 個角點做透視校正
    覆寫 original image（後續 clean 會用校正後的版本）
    """
    if len(payload.corners) != 4:
        raise HTTPException(status_code=400, detail='必須提供 4 個角點')

    corners = [(c.x, c.y) for c in payload.corners]
    local_path = _get_paper_original_local(payload.paper_id)

    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp_out = Path(tmp.name)

    try:
        import numpy as np
        warp_document(local_path, corners, tmp_out)

        # 讀尺寸
        warped_img = cv2.imdecode(
            np.frombuffer(tmp_out.read_bytes(), dtype=np.uint8),
            cv2.IMREAD_COLOR,
        )
        h, w = warped_img.shape[:2]

        if settings.use_supabase:
            # 上傳到 Supabase，覆寫原 path（加 -warped 後綴避免 cache）
            paper = storage.get_paper(payload.paper_id)
            if not paper:
                raise HTTPException(status_code=404, detail='找不到對應的 paperId')
            new_path = f'uploads/{payload.paper_id}-warped.png'
            storage.upload_bytes(new_path, tmp_out.read_bytes(), 'image/png')
            # 更新 DB 的 original_path 指向 warped 版本
            storage.client.table('papers').update({
                'original_path': new_path,
                'cleaned_paths': {},  # 清掉舊的 cleanup cache
            }).eq('paper_id', payload.paper_id).execute()
            warped_url = storage.public_url(new_path)
        else:
            # Local：直接覆寫
            warped_path = storage.uploads / f'{payload.paper_id}-warped.png'
            warped_path.write_bytes(tmp_out.read_bytes())
            papers_index[payload.paper_id] = warped_path
            warped_url = storage.public_url(warped_path)

        return WarpPaperResponse(
            paper_id=payload.paper_id,
            warped_image_url=warped_url,
            width=w,
            height=h,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'透視校正失敗：{exc}')
    finally:
        tmp_out.unlink(missing_ok=True)


@router.post('/{paper_id}/detect-questions', response_model=DetectQuestionsResponse)
async def detect_questions(paper_id: str) -> DetectQuestionsResponse:
    """
    用 vision LLM 偵測考卷上每一題的位置。

    PoC 結論（2026-04-11）：
    - Gemini 2.5 Flash 在正常單頁直式考卷上 14/14 全對 ✅
    - 本地 Gemma 4 26B 不堪用（給絕對 bbox 全是亂猜的 grid）❌
    - 預設走 gemini（settings.llm_provider）

    回傳：normalized bbox（0~1），前端可直接套到任意縮放尺寸。
    """
    import numpy as np

    local_path = _get_paper_original_local(paper_id)
    image_bytes = local_path.read_bytes()

    # 讀尺寸（給前端用）+ 縮圖預處理（vision LLM 對解析度敏感，
    # 太大會慢且不會更準；1600px 是 PoC 驗證過的甜蜜點）
    img = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=500, detail='無法讀取原圖')
    h, w = img.shape[:2]

    max_side = 1600
    if max(h, w) > max_side:
        scale = max_side / max(h, w)
        small = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = img
    ok, encoded = cv2.imencode('.png', small)
    if not ok:
        raise HTTPException(status_code=500, detail='無法重新編碼圖片')
    send_bytes = encoded.tobytes()

    provider = get_provider()
    provider_name = 'ollama' if isinstance(provider, OllamaProvider) else 'gemini'

    try:
        boxes = provider.detect_questions(send_bytes)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'LLM 偵測失敗（{provider_name}）：{exc}')

    return DetectQuestionsResponse(
        paper_id=paper_id,
        image_width=w,
        image_height=h,
        provider=provider_name,
        questions=[QuestionBoxOut(q_num=b.q_num, x=b.x, y=b.y, w=b.w, h=b.h, confidence=b.confidence) for b in boxes],
    )


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
