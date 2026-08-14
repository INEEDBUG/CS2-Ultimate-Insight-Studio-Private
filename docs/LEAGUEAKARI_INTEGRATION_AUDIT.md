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
- Client toolkit overview plus LeagueAkari-equivalent mission (`SELECT_REWARDS`), reward-grant (`PENDING_SELECTION`) and Event Hub claim flows, and selected-friend deletion. The implementation re-reads live LCU state immediately before every write, never preselects or randomly chooses a reward, requires a default-off account-write master switch and exact confirmation phrase, and deletes only explicitly selected friend IDs.
- LeagueAkari client/lobby/profile toolkit parity: eligible/unavailable queue discovery, revalidated queue-lobby creation, explicit lobby leave, Strawberry champion slot/map/difficulty controls, profile background skin/augment selection, banner accent, prestige-crest removal, challenge-token clearing and account-scope emote clearing. Every account write shares the default-off toolkit gate, exact confirmation phrase and live catalog/lobby revalidation.
- Opt-in local respawn countdown in League Mini through the in-game Live Client Data endpoint; disabled by default.
- Thirty-second enriched live-game cache so frequent UI refreshes do not repeatedly request every player's history.
- League Mini ARAM bench card with current champion, bench choices, reroll count, manual swap and reroll actions.
- Independent resizable real-time match window, sharing the cached team/premade/champion-usage analysis with the main lab.
- SGP match-history fallback for Tencent and supported global regions, using an on-demand in-memory entitlements token and exposing the active LCU/SGP source in the player center.
- Full cross-region Riot ID lookup through the local Riot Client player-account alias endpoint, followed by target-server SGP summoner, ranked, challenge and match-history routing; Riot Client credentials remain memory-only.
- LeagueAkari-equivalent first-14-minute jungle timeline analysis for LCU and SGP details: start-camp inference, top/mid/bottom activity weights, gank participation, level-3/4 pressure, local unsent scouting drafts, player-center profiles and automatic current-jungler enrichment in the live ten-player view.
- League Mini owned-skin selector with chroma support; options come from the current LCU inventory snapshot and unowned/disabled IDs are rejected server-side.
- Visual rune and summoner-spell loadout editor backed by the current LCU catalog; perk selection no longer requires manually typing numeric IDs.
- LeagueAkari-style streamer privacy mode across the main League lab, player center, Mini and independent ongoing-game window, with stable optional aliases, local-tag/PUUID masking and optional native capture protection.
- Reversible `PersistedSettings.json` read-only/writable control using the LCU-reported install directory, including Tencent's separate `Game/Config` layout.
- LeagueClientUx window repair parity: read the live zoom scale, resize both the native `RCLIENT` shell and `CefBrowserWindow`, then center the client; the action is manual and confirmed.
- Card/subset champion-select parity: the server-provided subset list now gates automatic picks and bench swaps during `BAN_PICK`, and Arena's special `-3` bravery action is available as a first-class ordered pick choice.
- Login automation parity for chat-ready state: after `/lol-chat/v1/me` remains available for two seconds, the app can restore the saved status message and displayed ranked queue/tier/division once per client connection. Manual application interrupts that login pass, apex tiers omit division, disconnects reset the state, and every write remains disabled by default behind the master automation switch.
- LeagueAkari-style enemy summoner-spell timer: an independent transparent, always-on-top and non-focusable Tauri overlay follows supported `InProgress` modes, orders the enemy team by position, applies mode ability haste, supports countdown/countup and reversible wheel correction, and can send a generated game-clock callout only after an explicit double-right-click while `League of Legends.exe` is the foreground process. The feature and native input remain disabled by default.
- OP.GG auxiliary-window parity: a separately managed, resizable and pinned window proxies only the fixed `lol-api-champion.op.gg` origin, supports mode/region/tier/position/version filters, a searchable tier table and champion build details for spells, runes, skill order, items, counters, synergies and Arena augments. ChampSelect follows the current champion/mode/position and can explicitly or automatically apply the leading spell/rune/item recommendations. Every automatic write defaults off; existing integrated champion loadouts win conflicts, item-set writes are atomic, and EndOfGame cleanup removes only `insight-opgg-*` files.
- Arbitrary Game ID preview and dry-run parity: the toolkit resolves a completed match through LCU with current-region SGP fallback, normalizes both team scoreboards, optionally loads the timeline summary, and can route the historical roster into the existing ongoing-game panel without writing any client state.
- Configurable global game-termination shortcut parity: the Tauri global-shortcut plugin is scoped to the main window, registration is driven by persisted League settings, the feature defaults off, and every trigger still passes the backend foreground-process guard before `League of Legends.exe` can be terminated.
- In-game-send parity: fixed-text presets support ordered multiline content, optional global shortcuts and an independent cancel shortcut, while recent-form, premade and jungle-analysis drafts support friendly/enemy/all targeting with nine independent target shortcuts. Lobby and ChampSelect use the matching LCU conversation; InProgress sends one line at a time only after re-reading the live phase and verifying `League of Legends.exe` remains foreground. The account-write gate, feature switch and every preset shortcut all default off, while manual sends require the exact confirmation phrase. Global show shortcuts are also available for the stateful ongoing-game window, OP.GG and cooldown timer.

### Implemented with deliberate React/Tauri presentation differences

- Pick/ban: core upstream behavior, subset-card modes and Arena bravery are implemented. The editor uses the live LCU champion catalog, official champion artwork, role filtering and ordered selection. Mode routing is expressed as stable semantic profiles instead of copying LeagueAkari's internal queue-group object names.
- Champion config: saved loadouts plus LCU-backed champion artwork search, primary/secondary rune selection, named summoner-spell selection and LeagueAkari-equivalent normal/ranked-position/ARAM/URF/Nexus Blitz/Ultimate Spellbook routing with fallback are implemented.
- Honor: strategy parity is implemented; the UI intentionally keeps the feature opt-in and disabled by default.
- Invitations: per-type strategy, priority ordering, away gating and the complete upstream dynamic queue-type strategy catalog are implemented.
- Match history: current and cross-player rows, Riot ID lookup, pagination, ranked/mastery summary, recently encountered players, local tags, basic filters, named presets, SGP fallback, one-click 100-match SQLite collection, aggregate performance metrics, SGP collection challenges and expanded match cards exist. The rule editor supports arbitrarily nested AND/OR/NOT groups over game identity/result/time, champion/position, spells/items/perks/augments, KDA/multikills, combat, vision and economy fields, targeting the current player or any/every ally, enemy or other participant.
- Mini and auxiliary windows: phase-driven show/hide, safe manual close, dedicated `mini.html`, ARAM bench swap/reroll, owned-skin selection, respawn countdown, live ReadyCheck/pick-ban/matchmaking/phase-action countdowns and champ-select phase timer are implemented. Independent ongoing-game, OP.GG and spell-cooldown windows are implemented with separate lifecycle state.

### Deliberately not exposed because upstream is incomplete

- Loot crafting/redeeming is intentionally not exposed: the reviewed upstream `LootTools.vue` labels itself under development and leaves its `craft` handler empty. Read-only inventory parity is retained until upstream itself has a working, auditable user flow.

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
