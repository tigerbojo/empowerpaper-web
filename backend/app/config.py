from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='EMPOWERPAPER_', env_file='.env', extra='ignore')

    app_name: str = 'EmpowerPaper API'
    public_base_url: str = 'http://localhost:8001'
    storage_root: Path = Field(default=Path(__file__).resolve().parent.parent / 'data')
    allowed_origins: list[str] = Field(default_factory=lambda: [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5175',
        'https://empowerpaper-web.vercel.app',
        'https://empowerpaper-web-tigerbojos-projects.vercel.app',
    ])


settings = Settings()
