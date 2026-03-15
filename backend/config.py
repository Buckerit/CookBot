from pydantic_settings import BaseSettings
from pydantic import Field
from pathlib import Path


class Settings(BaseSettings):
    openai_api_key: str = Field(default="", env="OPENAI_API_KEY")
    openai_model_chat: str = Field("gpt-4o-mini", env="OPENAI_MODEL_CHAT")
    openai_model_vision: str = Field("gpt-4o", env="OPENAI_MODEL_VISION")
    openai_tts_model: str = Field("tts-1", env="OPENAI_TTS_MODEL")
    openai_tts_voice: str = Field("alloy", env="OPENAI_TTS_VOICE")
    openai_realtime_model: str = Field("gpt-realtime", env="OPENAI_REALTIME_MODEL")
    openai_realtime_voice: str = Field("marin", env="OPENAI_REALTIME_VOICE")
    elevenlabs_api_key: str = Field(default="", env="ELEVENLABS_API_KEY")
    elevenlabs_voice_id: str = Field("EXAVITQu4vr4xnSDxMaL", env="ELEVENLABS_VOICE_ID")
    elevenlabs_model_id: str = Field("eleven_flash_v2_5", env="ELEVENLABS_MODEL_ID")
    whisper_model: str = Field("whisper-1", env="WHISPER_MODEL")

    database_url: str = Field("", env="DATABASE_URL")

    storage_base: str = Field("storage", env="STORAGE_BASE")
    max_video_duration_seconds: int = Field(3600, env="MAX_VIDEO_DURATION_SECONDS")
    ocr_engine: str = Field("paddleocr", env="OCR_ENGINE")

    host: str = Field("0.0.0.0", env="HOST")
    port: int = Field(8000, env="PORT")
    log_level: str = Field("INFO", env="LOG_LEVEL")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def storage_path(self) -> Path:
        return Path(self.storage_base)

    @property
    def recipes_path(self) -> Path:
        return self.storage_path / "recipes"

    @property
    def sessions_path(self) -> Path:
        return self.storage_path / "sessions"

    @property
    def media_path(self) -> Path:
        return self.storage_path / "media"

    @property
    def downloads_path(self) -> Path:
        return self.media_path / "downloads"

    @property
    def audio_cache_path(self) -> Path:
        return self.media_path / "audio"

    @property
    def keyframes_path(self) -> Path:
        return self.media_path / "keyframes"

    @property
    def thumbnails_path(self) -> Path:
        return self.media_path / "thumbnails"


settings = Settings()
