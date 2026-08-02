import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cs2_local_settings import discover_cs2_settings


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def test_discovers_and_parses_cs2_account_settings(tmp_path: Path):
    account_id = "123456"
    steam_id64 = str(76561197960265728 + int(account_id))
    cfg = tmp_path / "userdata" / account_id / "730" / "local" / "cfg"
    _write(
        cfg / "cs2_video.txt",
        '"setting.defaultres" "1024"\n"setting.defaultresheight" "1080"\n'
        '"setting.aspectratiomode" "0"\n"setting.fullscreen" "1"\n',
    )
    _write(
        cfg / "cs2_user_convars_0_slot0.vcfg",
        '"sensitivity" "0.35"\n"m_yaw" "0.022"\n"zoom_sensitivity_ratio" "1"\n',
    )
    _write(
        tmp_path / "config" / "loginusers.vdf",
        f'"users"\n{{\n"{steam_id64}"\n{{\n"AccountName" "tester"\n'
        '"PersonaName" "Player"\n"MostRecent" "1"\n"Timestamp" "10"\n}\n}\n',
    )

    result = discover_cs2_settings(tmp_path)

    assert result["found"] is True
    assert result["active_account_id"] == account_id
    account = result["accounts"][0]
    assert account["persona_name"] == "Player"
    assert account["settings"]["game_width"] == 1024
    assert account["settings"]["game_height"] == 1080
    assert account["settings"]["display_aspect"] == "4:3"
    assert account["settings"]["current_sensitivity"] == 0.35
    assert account["settings"]["m_yaw"] == 0.022
    assert account["settings"]["dpi"] is None


def test_prefers_loginusers_most_recent_account(tmp_path: Path):
    ids = ("111", "222")
    blocks = []
    for index, account_id in enumerate(ids):
        cfg = tmp_path / "userdata" / account_id / "730" / "local" / "cfg"
        _write(cfg / "cs2_video.txt", '"setting.defaultres" "1920"\n"setting.defaultresheight" "1080"\n')
        _write(cfg / "cs2_user_convars_0_slot0.vcfg", f'"sensitivity" "{index + 1}"\n')
        sid64 = 76561197960265728 + int(account_id)
        blocks.append(f'"{sid64}"\n{{\n"MostRecent" "{1 if account_id == "111" else 0}"\n}}')
    _write(tmp_path / "config" / "loginusers.vdf", '"users"\n{\n' + "\n".join(blocks) + "\n}")

    result = discover_cs2_settings(tmp_path)

    assert result["active_account_id"] == "111"
