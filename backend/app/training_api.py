"""Local-only training APIs."""

from __future__ import annotations

from fastapi import APIRouter, Query

from .env_utils import resolve_config_path
from .sensitivity_lab import (
    SensitivityRecommendationRequest,
    recommend_sensitivity,
)
from .training_db import TrainingDB


router = APIRouter(prefix="/api/training", tags=["training"])
_training_db: TrainingDB | None = None


def get_training_db() -> TrainingDB:
    global _training_db
    if _training_db is None:
        _training_db = TrainingDB(resolve_config_path().parent / "cs2-insight.db")
    return _training_db


@router.post("/sensitivity/recommend")
async def create_sensitivity_recommendation(body: SensitivityRecommendationRequest):
    recommendation = recommend_sensitivity(body)
    return await get_training_db().save_sensitivity_session(
        body.model_dump(mode="json"),
        recommendation.model_dump(mode="json"),
    )


@router.get("/sensitivity/history")
async def list_sensitivity_history(limit: int = Query(default=20, ge=1, le=100)):
    return {"items": await get_training_db().list_sensitivity_sessions(limit)}
