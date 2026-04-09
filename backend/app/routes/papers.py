from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from ..image_cleanup import cleanup_exam_image
from ..job_store import job_store
from ..schemas import CleanJobResult, CleanPaperRequest, CleanPaperResponse, UploadPaperResponse
from ..storage import storage

router = APIRouter(prefix='/papers', tags=['papers'])

papers_index: dict[str, Path] = {}


def _run_cleanup(paper_id: str, job_id: str) -> None:
    try:
        original_path = papers_index[paper_id]
        cleaned_path = storage.build_cleaned_path(paper_id)
        cleanup_exam_image(original_path, cleaned_path)
        job_store.complete(job_id, storage.public_url(cleaned_path))
    except Exception as exc:
        job_store.fail(job_id, str(exc))


@router.post('/upload', response_model=UploadPaperResponse)
async def upload_paper(file: UploadFile = File(...)) -> UploadPaperResponse:
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='只支援圖片格式上傳')

    paper_id = storage.new_paper_id()
    path = await storage.save_upload(paper_id, file)
    papers_index[paper_id] = path

    return UploadPaperResponse(
        paper_id=paper_id,
        original_image_url=storage.public_url(path),
        status='uploaded',
    )


@router.post('/clean', response_model=CleanPaperResponse)
async def clean_paper(payload: CleanPaperRequest, background_tasks: BackgroundTasks) -> CleanPaperResponse:
    if payload.paper_id not in papers_index:
        raise HTTPException(status_code=404, detail='找不到對應的 paperId')

    cleaned_path = storage.build_cleaned_path(payload.paper_id)
    if cleaned_path.exists():
        return CleanPaperResponse(
            paper_id=payload.paper_id,
            job_id='existing',
            status='completed',
            cleaned_image_url=storage.public_url(cleaned_path),
        )

    job_id = storage.new_job_id()
    job_store.create(payload.paper_id, job_id)
    background_tasks.add_task(_run_cleanup, payload.paper_id, job_id)

    return CleanPaperResponse(
        paper_id=payload.paper_id,
        job_id=job_id,
        status='processing',
        cleaned_image_url=None,
    )


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
        error=state.error,
    )
