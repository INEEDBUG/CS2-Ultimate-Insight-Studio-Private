"""SQLite persistence for local sensitivity and input-training sessions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import aiosqlite

from .demo_db import utc_now_iso


class TrainingDB:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    async def init_tables(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.db_path) as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sensitivity_sessions (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at          TEXT NOT NULL,
                    dpi                 INTEGER NOT NULL,
                    current_sensitivity REAL NOT NULL,
                    recommended_sensitivity REAL NOT NULL,
                    game_width          INTEGER NOT NULL,
                    game_height         INTEGER NOT NULL,
                    display_aspect      TEXT NOT NULL,
                    scaling_mode        TEXT NOT NULL,
                    confidence          REAL NOT NULL,
                    request_json        TEXT NOT NULL,
                    result_json         TEXT NOT NULL
                )
                """,
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sensitivity_sessions_created "
                "ON sensitivity_sessions(created_at DESC, id DESC)",
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS input_lab_sessions (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at     TEXT NOT NULL,
                    keyboard_name  TEXT NOT NULL,
                    mode           TEXT NOT NULL,
                    actuation_mm   REAL NOT NULL,
                    rt_press_mm    REAL NOT NULL,
                    rt_release_mm  REAL NOT NULL,
                    stability_score REAL NOT NULL,
                    request_json   TEXT NOT NULL,
                    result_json    TEXT NOT NULL
                )
                """,
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_input_lab_sessions_created "
                "ON input_lab_sessions(created_at DESC, id DESC)",
            )
            await conn.commit()

    async def save_sensitivity_session(
        self,
        request: dict[str, Any],
        result: dict[str, Any],
    ) -> dict[str, Any]:
        created_at = utc_now_iso()
        async with aiosqlite.connect(self.db_path) as conn:
            cursor = await conn.execute(
                """
                INSERT INTO sensitivity_sessions(
                    created_at, dpi, current_sensitivity, recommended_sensitivity,
                    game_width, game_height, display_aspect, scaling_mode,
                    confidence, request_json, result_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    created_at,
                    int(request["dpi"]),
                    float(request["current_sensitivity"]),
                    float(result["recommended_sensitivity"]),
                    int(request["game_width"]),
                    int(request["game_height"]),
                    str(request["display_aspect"]),
                    str(request["scaling_mode"]),
                    float(result["confidence"]),
                    json.dumps(request, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                ),
            )
            await conn.commit()
            return {"id": int(cursor.lastrowid), "created_at": created_at, **result}

    async def list_sensitivity_sessions(self, limit: int = 20) -> list[dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute(
                """
                SELECT id, created_at, dpi, current_sensitivity,
                       recommended_sensitivity, game_width, game_height,
                       display_aspect, scaling_mode, confidence, result_json
                FROM sensitivity_sessions
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (max(1, min(int(limit), 100)),),
            )
            rows = await cursor.fetchall()
        output = []
        for row in rows:
            result = json.loads(str(row["result_json"]))
            output.append({
                "id": int(row["id"]),
                "created_at": str(row["created_at"]),
                "dpi": int(row["dpi"]),
                "current_sensitivity": float(row["current_sensitivity"]),
                "recommended_sensitivity": float(row["recommended_sensitivity"]),
                "game_width": int(row["game_width"]),
                "game_height": int(row["game_height"]),
                "display_aspect": str(row["display_aspect"]),
                "scaling_mode": str(row["scaling_mode"]),
                "confidence": float(row["confidence"]),
                "edpi": result.get("edpi"),
                "cm_per_360": result.get("cm_per_360"),
                "m_yaw": result.get("m_yaw", 0.022),
            })
        return output

    async def save_input_session(self, request: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        created_at = utc_now_iso()
        async with aiosqlite.connect(self.db_path) as conn:
            cursor = await conn.execute(
                """
                INSERT INTO input_lab_sessions(
                    created_at, keyboard_name, mode, actuation_mm, rt_press_mm,
                    rt_release_mm, stability_score, request_json, result_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    created_at,
                    str(request["keyboard_name"]),
                    str(request["mode"]),
                    float(request["actuation_mm"]),
                    float(request["rapid_trigger_press_mm"]),
                    float(request["rapid_trigger_release_mm"]),
                    float(result["stability_score"]),
                    json.dumps(request, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                ),
            )
            await conn.commit()
            return {"id": int(cursor.lastrowid), "created_at": created_at, **result}

    async def list_input_sessions(self, limit: int = 20) -> list[dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute(
                """
                SELECT id, created_at, keyboard_name, mode, actuation_mm,
                       rt_press_mm, rt_release_mm, stability_score, result_json
                FROM input_lab_sessions
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (max(1, min(int(limit), 100)),),
            )
            rows = await cursor.fetchall()
        return [
            {
                "id": int(row["id"]),
                "created_at": str(row["created_at"]),
                "keyboard_name": str(row["keyboard_name"]),
                "mode": str(row["mode"]),
                "actuation_mm": float(row["actuation_mm"]),
                "rapid_trigger_press_mm": float(row["rt_press_mm"]),
                "rapid_trigger_release_mm": float(row["rt_release_mm"]),
                "stability_score": float(row["stability_score"]),
                **json.loads(str(row["result_json"])),
            }
            for row in rows
        ]
