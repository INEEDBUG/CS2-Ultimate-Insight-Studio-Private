<h1 align="center">
  <br>
  <img src="./frontend/public/cs2-ultimate-insight-logo.png" alt="CS2 Ultimate Insight Studio" width="140">
  <br>
  CS2 Ultimate Insight Studio
  <br>
</h1>

<p align="center">
  <a href="./README.md"><img src="./asset/icon-cn.svg" alt="" width="20" height="20" style="vertical-align: middle;"> 简体中文</a> | <img src="./asset/icon-en.svg" alt="" width="20" height="20" style="vertical-align: middle;"> English
</p>

<h3 align="center"><b>A local CS2 workspace for personal training and match review</b> </h3>
<h4 align="center">Official Demo Download · Demo Analysis · Sensitivity Lab · Magnetic Input Lab</h4>

> This repository is not software written from scratch. It is a clearly attributed, noncommercial derivative built from source-available and open-source projects. Read the source and license boundaries below before using or redistributing it.

<p align="center">
  <a href="./PLAYER_GUIDE_EN.md">User Guide</a> •
  <a href="./CONTRIBUTING_EN.md">Contributing</a> •
  <a href="#key-features">Key Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#source-code-and-attribution">Source & Attribution</a> •
  <a href="#disclaimer">Disclaimer</a> •
  <a href="#license">License</a>
</p>

## Source Code and Attribution

- **Core code and desktop architecture:** [DrEAmSs59/CS2-insight-agent](https://github.com/DrEAmSs59/CS2-insight-agent). This derivative retains its commit history, authorship and PolyForm Noncommercial 1.0.0 license while adding official-match Demo retrieval, SQLite workflows, sensitivity and magnetic-input labs, and independent branding.
- **Official Demo workflow reference:** [akiver/cs-demo-manager](https://github.com/akiver/cs-demo-manager). Its PostgreSQL data layer is not used, and the full project was not merged into this repository.
- **Steam Game Coordinator helper:** [akiver/boiler-writter](https://github.com/akiver/boiler-writter) 1.7.0 (GPL-3.0), downloaded only after first-use consent and executed unmodified as a separate process.
- **Share Code decoding:** a Python adaptation of [akiver/csgo-sharecode](https://github.com/akiver/csgo-sharecode) (MIT); its notice is retained at `third_party/licenses/csgo-sharecode-LICENSE.txt`.
- See [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) for the complete dependency and license boundaries.

This repository does not display upstream donation QR codes or solicit money on behalf of upstream authors. The new orange crosshair/data-pulse emblem is an original project asset and does not use Valve's official CS2 mark.

---

## Key Features

### Demo Library Management

- **Local Library Records** — List and thumbnail view showing match source, scoreboard, tracked players, display names, notes, and other key info.
- **Auto Directory Monitoring** — Supports monitoring demo download directories from 5E, Perfect World, Official Matchmaking, FACEIT, etc., with one-click import.

### Highlight Parsing & Clip Discovery

- **Batch Demo Parsing** — Parse highlights from multiple demos simultaneously; highlights from the same player across different matches are organized by match.
- **Persistent Analysis History** — Completed analysis is stored in the local SQLite database. Recent results can be reopened from the analysis page without reparsing the Demo.
- **Scoreboard First** — Base analysis now opens on the full-match scoreboard with K/D/A, ADR, KAST, headshot rate, openings, AWP and utility damage, plus an S–D grade and improvement notes for every player.
- **Per-round Player Assessment** — The round explorer and completed 2D replay state grade every player from kills, deaths, openings, headshots and objective events.
- **Interactive 2D Replay** — Review round-by-round positions, paths, kills, smokes and fire areas. Click either side roster or a radar marker to select a player, with selection shared across the replay and assessment cards.
- **Single-team Tactical View** — Switch between global, Team A only and Team B only to filter opponent positions, paths, shots and utility. This is a review filter, not simulated geometric line-of-sight.
- **Target Player Lock** — Automatically identify all players in a match and locate targets by Steam ID, platform ID, or nickname; compatible with different demo export conventions from 5E, Perfect World, and Official Matchmaking.
- **Fine-grained Highlight Analysis** — Automatically categorizes **Highlights** (multi-kills, one-taps, clutches, knife kills, jump shots, defuses), **Fails** (taser, Deagle, team kills, "human magnet", "human tracing", "shoulder-to-shoulder" moments), **Cross-round Compilations** (favorite victim, nemesis, kill/death montage, continuous round recording), and **Meme Rounds** (211/o/i/z series with AI round commentary). See [Clip Types & Tags](./docs/highlight_tags.md) for tag descriptions.
- **Round Timeline** — Beyond auto-extracted clip cards, browse kill/death timelines by round to add specific shots, deaths, or entire rounds to the recording queue.
- **Continuous Round Recording** — Record from round start to death or round end; select multiple rounds to combine into a longer clip.

> **First-run performance:** base Demo analysis and 2D replay cache generation are separate stages. The first visit to a match's 2D replay also creates the whole-match Parquet cache, round binary trajectories, and smoke/fire effect cache, so it can take longer than reopening the same match. Cache hits read the local result directly. Upgrades do not delete existing replay caches under `%APPDATA%\CS2 Insight Agent\data\cache\demo-replay`.

### Product Video

- [Watch the 3–5 minute Chinese product tour (MP4)](https://github.com/INEEDBUG/CS2-Ultimate-Insight-Studio-Private/releases/download/v2.4.6/CS2-Ultimate-Insight-Studio-v2.4.6-intro.mp4)
- 1920×1080, H.264 + AAC, ready for Bilibili and reusable as a horizontal Douyin upload.

### Training & Input Labs

- **Personal Sensitivity Diagnosis** — Combines no-click flick and continuous tracking results to identify a sensitivity that is too fast, too slow, balanced, or split between flick and tracking preferences. It returns an exact adjustment percentage, a CS2-ready `sensitivity` command, and a retest range.
- **Local CS2 CFG Prefill** — Read-only discovery of local Steam CS2 settings can prefill sensitivity, resolution, and aspect ratio. DPI and GPU scaling still require user confirmation.
- **Magnetic-key Optimization** — Uses duplicate edges, hold jitter, A/D overlap, and direction-transition latency to recommend starting values for actuation, RT press, and RT release, followed by controlled `0.05–0.10 mm` retests.
- **Official Matchmaking Input Safety** — Regular Rapid Trigger can shorten key reset, while Snap Tap, Rapid Tap, Snappy Tappy, SOCD/LKP, and similar automated counter-direction features should be disabled for CS2 official matchmaking.

### Auto Recording

- **Batch Recording Queue** — Queue multiple matches and clips; the program sequentially launches CS2 replay and drives OBS to produce videos; preview the entire plan before recording, with per-clip timing adjustments in the queue.
- **Pre-recording Spectator Settings** — One-click spectator HUD configuration (death notices only, hide IDs/chat/demo bars), FOV and viewmodel, flash brightness, voice, resolution and aspect ratio, OBS transitions between clips; experimental POV first-person HUD can be enabled per-match.
- **Diverse Output Styles**:
  - Observer view or POV first-person HUD (toggle radar, adjust top player count display)
  - Clean spectator view, custom FOV, hide grenade trajectories
  - **Victim POV** — After highlight or multi-kill compilations, automatically append victim perspective clips
  - **Keyboard Overlay** — Display WASD, crouch/jump keys in OBS, with manual sync adjustment if needed
  - Fade in/out transitions between clips
- **Safe Recording Solution**:
  - Controls recording via OBS and game state coordination, no injection or game hooking
  - Automatically backs up and restores your keybinds and graphics settings after recording


### Compilation Workbench

- Successfully recorded clips are automatically stored in the library; use the Compilation Workbench to drag-and-drop reorder, add BGM/transition themes, and export MP4; filter by highlight/fail/compilation/timeline types, with intro/outro arrangement.
- **Player Info Card** — Enable bottom-left corner watermark when exporting: briefly displays player nickname, clip type (highlight/fail/compilation), round and scenario tags (e.g., multi-kill, one-tap) at the start of each clip; upload custom avatars for each player appearing in the timeline, or display first letter of nickname if no avatar. Perfect for Bilibili-style highlight intros without manual PR editing.
- **FFmpeg Configuration Required**: Download Windows builds from [FFmpeg Official](https://ffmpeg.org/download.html) or [gyan.dev](https://www.gyan.dev/ffmpeg/builds/), extract and set the full path to `ffmpeg.exe` in the settings page. Export prioritizes GPU hardware encoding (NVENC/QSV/AMF), falling back to software encoding if unavailable.


### AI Commentary (Optional)

- **OpenAI-Compatible Multi-Provider** — Built-in support for DeepSeek, Tongyi Qwen, Zhipu GLM, MiniMax, OpenAI, OpenRouter; local models via Ollama, LM Studio.
- **Sarcastic Persona Prompt** — Hype for highlights, roast for fails, meme deaths as jokes; hard constraint under 100 characters, single-line JSON output, no off-topic chatter.
- **Round Meme Compilation Review** — 211/o/i/z meme rounds trigger "Round Comprehensive Review", independent from clip-level scoring.

---

## Installation

Download the latest `CS2 Ultimate Insight Studio_x.x.x_x64-setup.exe` from this repository's [Releases page](https://github.com/INEEDBUG/CS2-Ultimate-Insight-Studio-Private/releases), run the installer and follow the prompts.

After installation, launch from desktop or start menu. **No browser or manual backend start is required.** The lightweight Tauri shell starts the bundled Python backend and renders the UI with the Windows system WebView2 runtime.

The app does not run a background updater. Download new versions directly from [this project's Releases page](https://github.com/INEEDBUG/CS2-Ultimate-Insight-Studio-Private/releases).

> **Recommended: Installation path without Chinese characters.** e.g., `D:\CS2-Insight-Agent\` ✅, `D:\游戏工具\CS2-Insight-Agent\` ❌

---

## Roadmap

- **V1**
   - [X] Highlight Parsing
   - [X] AI Commentary
   - [X] Auto Director
- **V2**
   - [X] Lightweight Tauri Desktop
   - [X] Compilation Workbench (FFmpeg Export)
   - [X] POV HUD Experimental Feature
   - [X] Round Timeline Browse & Queue Recording
   - [X] Pre-recording Spectator Warm-up / Victim POV / Virtual Keyboard OBS Overlay
- **V3**
   - [X] Demo Analysis, History, and Player/Round Assessments
   - [X] 2D Player Selection and Single-team Tactical View
   - [ ] Tactical Coach (Grenade Trajectory Analysis / Route Review)


### Upstream contributors

<a href="https://github.com/DrEAmSs59/CS2-insight-agent/graphs/contributors">
  View the contributors and original commit history of `DrEAmSs59/CS2-insight-agent`
</a>


---

## License

This project is released under the [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) license.

- Personal learning, research, hobby, review, and other non-commercial uses are permitted. Under this license, you may read, modify, build, and distribute this project's source code and derivatives.
- Without written authorization, commercial use is prohibited, including but not limited to: commercial software, paid services, commercial editing/recording services, commercial platform integration, sales, rental, resale, or distribution as part of commercial products.
- 📦 If you distribute compiled products, installers, or modified versions of this project, please retain this project's license statement and comply with all third-party open source component licenses listed in `THIRD_PARTY_LICENSES.md`.

## Disclaimer

Counter-Strike 2, CS2, Counter-Strike, Steam, Valve and related names, trademarks, and logos belong to their respective owners.

This project is not affiliated with, partnered with, sponsored by, authorized by, or endorsed by Valve Corporation, Perfect World Arena, 5E Arena, OBS Studio, or other related platforms or software owners.

### Safe Usage Tips

- **Default Recording Process** launches CS2 with `-insecure` for local demo playback only; no DLL injection or hooking; does not modify `.dem` files on disk, does not connect to, modify, or interfere with any official game servers, matchmaking services, or anti-cheat systems, nor does it provide any cheating, detection bypass, or fair-play disruption features. **Do not use in parallel with a CS2 client logged into matchmaking servers** to avoid triggering unnecessary anti-cheat warnings.
- If you **actively enable POV** in "Common Parameters → Experimental Features", the program temporarily writes `pov.vpk` to CS2's `game/csgo` directory and **incrementally modifies** `gameinfo.gi`'s `SearchPaths` to load POV HUD resources; automatically restored after recording or abnormal termination. This mode also **forces** `-insecure` when launching CS2. **Do not use to connect to VAC-secured servers**.
- Recording temporarily modifies several CS2 archive cvars and keybinds. This project automatically backs up your original `config.cfg` / `video.txt` / `user_convars_*.vcfg` to the program data directory's `.cs2_config_backup` when starting recording, and restores them afterward; if settings were overwritten due to abnormal exit, manually retrieve original files from that directory.
