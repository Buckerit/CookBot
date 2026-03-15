from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime


class Ingredient(BaseModel):
    name: str
    quantity: Optional[str] = None
    unit: Optional[str] = None
    notes: Optional[str] = None


class Step(BaseModel):
    index: int
    instruction: str
    duration_seconds: Optional[int] = None
    tips: list[str] = Field(default_factory=list)
    ingredients_used: list[str] = Field(default_factory=list)
    timestamp_start_seconds: Optional[float] = None
    timestamp_end_seconds: Optional[float] = None
    image_timestamp_seconds: Optional[float] = None
    image_url: Optional[str] = None


class Recipe(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: Optional[str] = None
    servings: Optional[str] = None
    prep_time_minutes: Optional[int] = None
    cook_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    ingredients: list[Ingredient] = Field(default_factory=list)
    steps: list[Step] = Field(default_factory=list)
    source_url: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def summary(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "servings": self.servings,
            "cuisine": self.cuisine,
            "prep_time_minutes": self.prep_time_minutes,
            "cook_time_minutes": self.cook_time_minutes,
            "step_count": len(self.steps),
            "created_at": self.created_at.isoformat(),
        }
