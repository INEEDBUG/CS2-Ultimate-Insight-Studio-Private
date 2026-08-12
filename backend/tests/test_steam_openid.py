import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main


class _ValidOpenIdResponse:
    text = "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"

    def raise_for_status(self):
        return None


class _ValidOpenIdClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, data):
        assert url == "https://steamcommunity.com/openid/login"
        assert data["openid.mode"] == "check_authentication"
        return _ValidOpenIdResponse()


def test_steam_openid_flow_verifies_and_returns_steam_id(monkeypatch):
    main._steam_openid_flows.clear()
    monkeypatch.setattr(main.httpx, "AsyncClient", _ValidOpenIdClient)
    monkeypatch.setattr(main, "load_config", lambda: SimpleNamespace(steam_api_key=""))
    client = TestClient(main.app)

    started = client.post("/api/steam-openid/start").json()
    parsed = urlparse(started["auth_url"])
    query = parse_qs(parsed.query)
    assert parsed.netloc == "steamcommunity.com"
    assert query["openid.return_to"][0].startswith("http://127.0.0.1:")

    response = client.get(
        "/api/steam-openid/callback",
        params={
            "state": started["state"],
            "openid.mode": "id_res",
            "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000",
            "openid.identity": "https://steamcommunity.com/openid/id/76561198000000000",
            "openid.return_to": query["openid.return_to"][0],
            "openid.response_nonce": "2026-08-12T00:00:00Znonce",
            "openid.assoc_handle": "handle",
            "openid.signed": "claimed_id,identity,return_to,response_nonce,assoc_handle",
            "openid.sig": "signature",
        },
    )
    assert response.status_code == 200
    status = client.get(f"/api/steam-openid/status/{started['state']}").json()
    assert status["status"] == "complete"
    assert status["steam_id64"] == "76561198000000000"


def test_steam_openid_callback_rejects_unknown_state():
    response = TestClient(main.app).get(
        "/api/steam-openid/callback",
        params={"state": "missing-state-000000000000"},
    )
    assert response.status_code == 400
    assert "已过期" in response.text
