from app.steam_profiles import normalize_steam_id64, parse_public_avatar_xml


def test_public_avatar_xml_accepts_only_steam_static_https():
    assert parse_public_avatar_xml(
        "<profile><avatarFull>https://avatars.fastly.steamstatic.com/hash_full.jpg</avatarFull></profile>"
    ) == "https://avatars.fastly.steamstatic.com/hash_full.jpg"
    assert parse_public_avatar_xml(
        "<profile><avatarFull>https://example.com/avatar.jpg</avatarFull></profile>"
    ) is None
    assert parse_public_avatar_xml("not xml") is None


def test_steam_id64_requires_a_17_digit_public_identifier():
    assert normalize_steam_id64("76561198000000000") == "76561198000000000"
    assert normalize_steam_id64("123") is None
    assert normalize_steam_id64("7656119800000000x") is None
