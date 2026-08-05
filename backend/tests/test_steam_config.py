import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.env_utils import AppConfig

def test_steam_fields_defaults():
    cfg = AppConfig()
    assert cfg.steam_api_key == ""
    assert cfg.steam_id64 == ""
    assert cfg.steam_game_auth_code == ""
    assert cfg.steam_known_share_code == ""
    assert cfg.steam_match_share_codes == []
    assert cfg.match_mode == "premier"
    assert cfg.match_count == 20

def test_steam_fields_from_dict():
    cfg = AppConfig(
        steam_api_key="ABCD1234",
        steam_id64="76561198012345678",
        steam_game_auth_code="AAAA-AAAAA-AAAA",
        steam_known_share_code="CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H",
        steam_match_share_codes=["CSGO-88Xwc-WZWzc-Z2bjd-5apou-yqk2H"],
        match_mode="competitive",
        match_count=50,
    )
    assert cfg.steam_api_key == "ABCD1234"
    assert cfg.steam_id64 == "76561198012345678"
    assert cfg.steam_game_auth_code == "AAAA-AAAAA-AAAA"
    assert len(cfg.steam_match_share_codes) == 1
    assert cfg.match_mode == "competitive"
    assert cfg.match_count == 50
