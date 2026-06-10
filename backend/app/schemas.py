from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CleanupMode = Literal['opencv', 'unpaper', 'ai', 'auto']
CleanupProcessor = Literal['opencv', 'unpaper', 'ai']


class UploadPaperResponse(BaseModel):
    paper_id: str
    original_image_url: str
    status: Literal['uploaded'] = 'uploaded'


class CleanPaperRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    paper_id: str = Field(alias='paperId')
    mode: CleanupMode = 'auto'
    darkness: float = 1.0  # 0.5 ~ 1.5, 預設 1.0
    # 互動式擦除：使用者覆寫（元件 id 來自上一次回傳的 components）
    keep_ids: list[int] = Field(default_factory=list)
    erase_ids: list[int] = Field(default_factory=list)
    # 回傳元件清單（互動式擦除 UI 用）
    include_components: bool = False

    @model_validator(mode='before')
    @classmethod
    def normalize_keys(cls, data: Any) -> Any:
        if isinstance(data, dict) and 'paper_id' in data and 'paperId' not in data:
            data = {**data, 'paperId': data['paper_id']}
        return data


class CleanComponent(BaseModel):
    """單一連通元件（互動式擦除 UI 用，像素座標基於 cleaned image 尺寸）"""
    id: int
    x: int
    y: int
    w: int
    h: int
    erased: bool
    kind: Literal['removed', 'forced', 'restored', 'candidate', 'ink']


class CleanPaperResponse(BaseModel):
    paper_id: str
    job_id: str
    status: Literal['processing', 'completed']
    cleaned_image_url: str | None = None
    ocr_image_url: str | None = None
    processor: CleanupProcessor | None = None
    requested_mode: CleanupMode = 'auto'
    components: list[CleanComponent] | None = None
    image_width: int | None = None
    image_height: int | None = None


class CleanJobResult(BaseModel):
    paper_id: str
    job_id: str
    status: Literal['processing', 'completed', 'failed']
    cleaned_image_url: str | None = None
    ocr_image_url: str | None = None
    error: str | None = None
    processor: CleanupProcessor | None = None
    requested_mode: CleanupMode = 'auto'


class StoredPaper(BaseModel):
    paper_id: str
    original_path: Path
    cleaned_path: Path | None = None


class Corner(BaseModel):
    x: float
    y: float


class DetectCornersResponse(BaseModel):
    paper_id: str
    image_width: int
    image_height: int
    corners: list[Corner]  # 順序：左上、右上、右下、左下


class WarpPaperRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    paper_id: str = Field(alias='paperId')
    corners: list[Corner]

    @model_validator(mode='before')
    @classmethod
    def normalize_keys(cls, data: Any) -> Any:
        if isinstance(data, dict) and 'paper_id' in data and 'paperId' not in data:
            data = {**data, 'paperId': data['paper_id']}
        return data


class WarpPaperResponse(BaseModel):
    paper_id: str
    warped_image_url: str
    width: int
    height: int


class QuestionBoxOut(BaseModel):
    """偵測到的單一題目（normalized 座標 0~1，方便前端套到任意縮放尺寸）"""
    q_num: str
    x: float
    y: float
    w: float
    h: float
    confidence: float = 0.0


class DetectQuestionsResponse(BaseModel):
    paper_id: str
    image_width: int
    image_height: int
    provider: str            # "ollama" | "gemini"
    questions: list[QuestionBoxOut]
