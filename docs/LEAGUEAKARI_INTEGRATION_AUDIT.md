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
- Live-game recent-form and current-champion usage summaries, plus LeagueAkari-style premade inference from repeated same-team match history.
- Read-only client toolkit overview for missions, reward grants, loot inventory and friends; no claim, craft, redeem or delete action is exposed.
- Opt-in local respawn countdown in League Mini through the in-game Live Client Data endpoint; disabled by default.
- Thirty-second enriched live-game cache so frequent UI refreshes do not repeatedly request every player's history.
- League Mini ARAM bench card with current champion, bench choices, reroll count, manual swap and reroll actions.
- Independent resizable real-time match window, sharing the cached team/premade/champion-usage analysis with the main lab.
- SGP match-history fallback for Tencent and supported global regions, using an on-demand in-memory entitlements token and exposing the active LCU/SGP source in the player center.
- League Mini owned-skin selector with chroma support; options come from the current LCU inventory snapshot and unowned/disabled IDs are rejected server-side.
- Visual rune and summoner-spell loadout editor backed by the current LCU catalog; perk selection no longer requires manually typing numeric IDs.
- LeagueAkari-style streamer privacy mode across the main League lab, player center, Mini and independent ongoing-game window, with stable optional aliases, local-tag/PUUID masking and optional native capture protection.

### Partially implemented; upstream behavior is richer

- Pick/ban: core upstream behavior is implemented; remaining work is exact upstream queue-group metadata refresh, subset-card modes, special vote actions and champion artwork/role metadata parity.
- Champion config: saved loadouts plus LCU-backed champion artwork search, primary/secondary rune selection, named summoner-spell selection and LeagueAkari-equivalent normal/ranked-position/ARAM/URF/Nexus Blitz/Ultimate Spellbook routing with fallback are implemented.
- Honor: strategy parity is implemented; the UI intentionally keeps the feature opt-in and disabled by default.
- Invitations: per-type strategy, priority ordering, away gating and the complete upstream dynamic queue-type strategy catalog are implemented.
- Match history: current and cross-player rows, Riot ID lookup, pagination, ranked/mastery summary, recently encountered players, local tags, basic filters, named presets, AND/OR composable rules over champion/mode/position/queue/KDA/combat/economy fields, SGP fallback, one-click 100-match SQLite collection, aggregate performance metrics, SGP collection challenges and expanded match cards exist; upstream-only predicates that require richer timeline/team payloads remain.
- Mini window: phase-driven show/hide, safe manual close, dedicated `mini.html`, ARAM bench swap/reroll, owned-skin selection, respawn countdown, live ReadyCheck/pick-ban/matchmaking/phase-action countdowns and champ-select phase timer are implemented; remaining auxiliary cards remain.

### Not implemented yet

- Full cross-region Riot ID search through SGP; direct PUUID summoner fallback, match history and ranked-stat routing are implemented. Champion mastery remains LCU-only, matching current LeagueAkari behavior.
- Ongoing-game jungle-path analysis (live team/profile cards, premade detection and champion-usage summaries work now).
- Saved named filter presets and a local AND/OR composable rule builder are implemented; predicates requiring richer timeline/team payloads remain (the durable SQLite collection workspace works now).
- OP.GG and remaining specialized auxiliary overlay windows (an independent native real-time match window and Mini respawn timer now work).
- Reward/mission/event claiming plus mutating loot and friend tools (the read-only overview works now; writes require separate safety review).
- In-game preset messaging: explicit fixed-text presets for lobby/champion-select, plus manual chat availability and status-message tools are implemented; generated rating/jungle/premade presets and native keyboard injection during an active match remain.
- Client window sizing and game-client process controls. Streamer text masking and native Windows capture exclusion are implemented.

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
