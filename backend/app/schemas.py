from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UploadPaperResponse(BaseModel):
    paper_id: str
    original_image_url: str
    status: Literal['uploaded'] = 'uploaded'


class CleanPaperRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    paper_id: str = Field(alias='paperId')
    mode: Literal['basic', 'ai-enhanced'] = 'basic'

    @model_validator(mode='before')
    @classmethod
    def normalize_keys(cls, data: Any) -> Any:
        if isinstance(data, dict) and 'paper_id' in data and 'paperId' not in data:
            data = {**data, 'paperId': data['paper_id']}
        return data


class CleanPaperResponse(BaseModel):
    paper_id: str
    job_id: str
    status: Literal['processing', 'completed']
    cleaned_image_url: str | None = None


class CleanJobResult(BaseModel):
    paper_id: str
    job_id: str
    status: Literal['processing', 'completed', 'failed']
    cleaned_image_url: str | None = None
    error: str | None = None


class StoredPaper(BaseModel):
    paper_id: str
    original_path: Path
    cleaned_path: Path | None = None
