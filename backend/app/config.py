from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='EMPOWERPAPER_', env_file='.env', extra='ignore')

    app_name: str = 'EmpowerPaper API'
    public_base_url: str = 'http://localhost:8001'
    storage_root: Path = Field(default=Path(__file__).resolve().parent.parent / 'data')
    # Supabase（為空時 fallback 到本地檔案系統）
    supabase_url: str = ''
    supabase_service_key: str = ''
    supabase_bucket: str = 'papers'
    # LLM Vision provider
    # PoC 驗證：Gemini 2.5 Flash 在正常單頁考卷上 14/14 全對；
    # 本地 Gemma 4 26B 完全不行（給絕對 bbox 都是亂猜的 grid）。
    # 預設用 gemini，本地若想試 ollama 可設 EMPOWERPAPER_LLM_PROVIDER=ollama
    llm_provider: str = 'gemini'
    gemini_api_key: str = ''
    gemini_model: str = 'gemini-2.5-flash'
    ollama_url: str = 'http://localhost:11434'
    ollama_model: str = 'gemma4:26b'
    allowed_origins: list[str] = Field(default_factory=lambda: [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
        'https://empowerpaper-web.vercel.app',
        'https://empowerpaper-web-tigerbojos-projects.vercel.app',
    ])

    @property
    def use_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)


settings = Settings()
