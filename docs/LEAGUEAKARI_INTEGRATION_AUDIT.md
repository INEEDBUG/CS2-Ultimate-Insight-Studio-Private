# LeagueAkari integration audit

Baseline reviewed: `LeagueAkari` dev branch at `6e40999728f6408bddbb067fb89a81e086ae7d58`, plus the locally installed League Akari 1.5.1 shell. The upstream remains MIT licensed and is credited in `THIRD_PARTY_LICENSES.md`.

This document prevents the League integration from becoming a collection of unrelated toggles. It maps the upstream product into this project's Python/FastAPI + React/Tauri architecture and records what is actually implemented.

## Architecture reviewed

- Native client discovery: process enumeration and `NtQueryInformationProcess(ProcessCommandLineInformation)`; WMI is only an optional elevated fallback.
- LCU transport and state: authenticated local HTTPS, event subscriptions, state initialization, reconnect handling and Riot/Tencent client variants.
- SGP transport: regional service discovery, summoner, ranked statistics, match-history query and game-summary sources.
- Automation: `auto-gameflow`, `auto-select`, `auto-champ-config` and `auto-misc`.
- Player product: multi-player tabs, summary, ranked data, mastery, challenges, match cards, pagination, recent encounters, saved tags and advanced composable filters.
- Live-game product: ongoing-game player cards, premade detection, champion usage, jungle-path analysis, queue filters and auxiliary windows.
- Toolkit: lobby controls, client controls, in-game messages, chat presence/status, rewards, loot and friend tools.
- Desktop shell: tray, window manager, main/mini/auxiliary windows, shortcuts, updater, storage migrations and streamer mode.

## Current integration status

### Implemented and locally verified

- Native non-elevated LeagueClientUx discovery using the same Windows API strategy as LeagueAkari.
- Riot and WeGame/Tencent command-line parsing, local-memory-only LCU credentials and authenticated HTTPS calls.
- Current summoner, region/platform and gameflow phase status.
- Automatic ready check, play again, reconnect and basic invitation accept/decline policy.
- Automatic pick/ban priority, availability checks, delay and optional lock-in.
- Per-champion rune page and summoner-spell application.
- Automatic honor submission with ballot completion.
- Current-account LCU match history with champion metadata and core performance fields.
- Independent always-on-top League Mini window with phase/team summary and quick automation controls.
- Queue-group and position-specific pick/ban profiles with searchable ordered champion lists.
- Pick intent conflict handling, all three show/lock strategies, ARAM bench selection delay and champion-trade acceptance.
- Automatic leader handoff plus per-invite-type accept/decline/ignore rules and away-state gating.
- League Mini phase lifecycle parity: auto-show in lobby/matchmaking/ready-check/non-spectating champ select, auto-hide elsewhere, and manual close suppression until the phase changes.
- LCU `OnJsonApiEvent` WebSocket subscription with authenticated local event wakeups; timed polling remains only as recovery/fallback.
- LeagueAkari-equivalent automatic matchmaking gates: leader check, minimum members, pending invitees, penalty wait, start delay and fixed/estimated rematch cancellation.
- All upstream honor strategies: prefer lobby members, lobby-only, allies, allies plus opponents, and automatic opt-out.
- Player center foundation: current/cross-player summoner profile, ranked queues, top mastery, recent matches and durable local player tags.
- Ongoing-game foundation: current Gameflow teams, champion assignments, ranked/profile enrichment, local tags and click-through to player details.
- Event-driven private-chat auto reply, away-only gating, offline-status lock and one-shot ARAM side announcements.
- Event-driven friend auto-invitation queue: waits for an opted-in friend to become online, checks lobby permissions/membership, invites once and removes the completed target.
- Riot ID (`game name#tag`) cross-player lookup through the local LCU alias endpoint, paginated match history and durable recently encountered player indexing.

### Partially implemented; upstream behavior is richer

- Pick/ban: core upstream behavior is implemented; remaining work is exact upstream queue-group metadata refresh, subset-card modes, special vote actions and champion artwork/role metadata parity.
- Champion config: data model supports saved loadouts, but the editor still uses numeric IDs instead of upstream champion/rune/spell galleries and position presets.
- Honor: strategy parity is implemented; the UI intentionally keeps the feature opt-in and disabled by default.
- Invitations: per-type strategy, priority ordering and away gating are implemented; the UI still needs the complete upstream dynamic invite-type catalog.
- Match history: current and cross-player rows, Riot ID lookup, pagination, ranked/mastery summary, recently encountered players and local tags exist; upstream-level challenges, detailed cards and composable filters remain.
- Mini window: phase-driven show/hide, safe manual close and a dedicated `mini.html` entry are implemented; skin selection, bench controls, action countdowns and all auxiliary cards remain.

### Not implemented yet

- SGP-backed historical analysis and multi-source fallback (LCU Riot ID and PUUID lookup work now).
- Ongoing-game premade detection, champion-usage rates and jungle-path analysis (live team/profile cards work now).
- Match-history advanced filters, collect mode and multi-source fallback.
- Respawn timer and the ongoing-game/OP.GG/auxiliary overlay windows.
- Champion skin selector auxiliary window.
- Reward/mission/event claiming, loot tools and friend tools.
- In-game preset messaging and chat availability/status tools.
- Client window sizing, game-client process controls and streamer mode.

## Porting decisions

1. Port the mature state machines and endpoint behavior, not the Electron/Vue shell wholesale. React/Tauri remains the single desktop shell.
2. Replace one-second polling with LCU WebSocket event subscriptions before adding more automation; polling remains only as recovery/fallback.
3. Add SGP only after its regional authentication lifecycle, expiry and failure fallback are implemented. Do not expose tokens or persist them in plaintext.
4. Treat account-impacting or spam-prone toolkit features as opt-in and disabled by default. Destructive loot/reward operations require a separate safety review.
5. Preserve LeagueAkari attribution and MIT notice for adapted code. Do not copy artwork or third-party assets without verifying their individual licenses.

## Implementation order

1. Connection/state foundation: native discovery hardening, LCU event stream, reconnect state, Tencent/Riot fixtures.
2. Automation parity: matchmaking, leader/invitation rules, position-aware selection, intent/bench/trade behavior, visual rune/spell editor and honor strategies.
3. Player center: SGP + LCU source routing, full match cards, pagination, filters, ranked/mastery/challenges, recent players and tags.
4. Live assistant: ongoing-game analysis, premade/team insights and phase-specific Mini window.
5. Optional toolkit: only individually reviewed, clearly labeled and opt-in modules.

The formal release remains blocked until the locally installed release candidate is exercised against ReadyCheck, ChampSelect and EndOfGame on the user's Tencent account.
