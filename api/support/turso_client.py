"""
Cliente HTTP para Turso (libSQL) — Vercel no soporta el cliente libsql nativo en Python
de forma sencilla, así que usamos la API HTTP v2.
"""

import os
import httpx
from typing import Optional, List, Dict, Any

TURSO_URL_RAW = os.getenv("TURSO_DATABASE_URL", "").strip()
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "").strip()

if not TURSO_URL_RAW:
    raise RuntimeError("❌ Falta TURSO_DATABASE_URL")
if not TURSO_TOKEN:
    raise RuntimeError("❌ Falta TURSO_AUTH_TOKEN")

TURSO_URL = TURSO_URL_RAW.replace("libsql://", "https://").rstrip("/")
PIPELINE_URL = f"{TURSO_URL}/v2/pipeline"


def _to_arg(value: Any) -> Dict[str, Any]:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "real", "value": str(value)}
    return {"type": "text", "value": str(value)}


def _parse_cell(cell: Any) -> Any:
    if cell is None:
        return None
    if not isinstance(cell, dict):
        return cell

    t = cell.get("type")
    v = cell.get("value")

    if t == "null":
        return None
    if t == "integer":
        try:
            return int(v) if v is not None else 0
        except (ValueError, TypeError):
            return 0
    if t == "real":
        try:
            return float(v) if v is not None else 0.0
        except (ValueError, TypeError):
            return 0.0
    if t == "text":
        return v if v is not None else ""
    if t == "blob":
        return v
    return v


def _pipeline(sql: str, args: Optional[List[Any]] = None) -> Dict[str, Any]:
    stmt = {
        "sql": sql,
        "args": [_to_arg(a) for a in (args or [])],
    }
    body = {"requests": [{"type": "execute", "stmt": stmt}, {"type": "close"}]}

    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(
                PIPELINE_URL,
                headers={
                    "Authorization": f"Bearer {TURSO_TOKEN}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
    except httpx.RequestError as e:
        raise RuntimeError(f"Turso HTTP request error: {e}")

    if r.status_code != 200:
        raise RuntimeError(f"Turso HTTP {r.status_code}: {r.text[:300]}")

    try:
        data = r.json()
    except Exception:
        raise RuntimeError(f"Turso respuesta no-JSON: {r.text[:300]}")

    for res in (data.get("results") or []):
        if res.get("type") == "error":
            err = res.get("error") or {}
            msg = err.get("message") or str(err)
            raise RuntimeError(f"Turso error: {msg}")
        if res.get("type") == "ok":
            response = res.get("response") or {}
            if response.get("type") == "execute":
                return response.get("result") or {}

    return {}


def turso_query(sql: str, args: Optional[List[Any]] = None) -> List[Dict[str, Any]]:
    result = _pipeline(sql, args)
    cols = [c["name"] for c in (result.get("cols") or [])]
    raw_rows = result.get("rows") or []

    parsed_rows: List[Dict[str, Any]] = []
    for raw in raw_rows:
        row: Dict[str, Any] = {}
        for i, col in enumerate(cols):
            cell = raw[i] if i < len(raw) else None
            row[col] = _parse_cell(cell)
        parsed_rows.append(row)

    return parsed_rows


def turso_query_one(sql: str, args: Optional[List[Any]] = None) -> Optional[Dict[str, Any]]:
    rows = turso_query(sql, args)
    return rows[0] if rows else None


def turso_execute(sql: str, args: Optional[List[Any]] = None) -> Dict[str, Any]:
    result = _pipeline(sql, args)
    return {
        "affected_row_count": result.get("affected_row_count", 0),
        "last_insert_rowid": result.get("last_insert_rowid"),
    }