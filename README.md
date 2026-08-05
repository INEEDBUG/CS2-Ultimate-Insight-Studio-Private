<h1 align="center">
  <br>
  <img src="./frontend/public/cs2-ultimate-insight-logo.png" alt="CS2 Ultimate Insight Studio" width="140">
  <br>
  CS2 Ultimate Insight Studio
  <br>
</h1>

<p align="center">
  <img src="./asset/icon-cn.svg" alt="" width="20" height="20" style="vertical-align: middle;"> 简体中文 | <a href="./README_EN.md"><img src="./asset/icon-en.svg" alt="" width="20" height="20" style="vertical-align: middle;"> English</a>
</p>

<h3 align="center"><b>面向个人训练与复盘的本地 CS2 工作台</b> </h3>
<h4 align="center">官匹 Demo 获取 · Demo 分析 · 灵敏度实验室 · 磁轴输入实验室</h4>

> 本仓库不是从零编写的软件，而是明确基于开源/源码可用项目继续开发的非商业衍生版本。请在使用或分发前阅读下面的代码来源与许可证说明。

<p align="center">
  <a href="./PLAYER_GUIDE.md">使用指南</a> •
  <a href="./CONTRIBUTING.md">贡献指南</a> •
  <a href="#核心功能">核心功能</a> •
  <a href="#安装">快速安装</a> •
  <a href="#代码来源与致谢">代码来源</a> •
  <a href="#声明">声明</a> •
  <a href="#License">License</a>
</p>

## 代码来源与致谢

- **主体代码与桌面架构**：[DrEAmSs59/CS2-insight-agent](https://github.com/DrEAmSs59/CS2-insight-agent)。本项目保留其提交历史、作者归属及 PolyForm Noncommercial 1.0.0 许可，并在此基础上增加官匹 Demo 获取、SQLite 工作流、灵敏度实验室、磁轴输入实验室和独立品牌界面。
- **官匹 Demo 工作流参考**：[akiver/cs-demo-manager](https://github.com/akiver/cs-demo-manager)。本项目没有采用它的 PostgreSQL 数据层，也没有把整个项目代码直接合并进来。
- **Steam Game Coordinator 辅助程序**：[akiver/boiler-writter](https://github.com/akiver/boiler-writter) 1.7.0（GPL-3.0）。它在用户首次明确同意后按需下载，并以未修改的独立进程运行。
- **Share Code 解码代码**：[akiver/csgo-sharecode](https://github.com/akiver/csgo-sharecode)（MIT）的 Python 适配，许可证原文保存在 `third_party/licenses/csgo-sharecode-LICENSE.txt`。
- 完整第三方依赖与许可证边界见 [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)。

本仓库不展示任何上游作者的收款码，也不代表上游作者募集赞助。新的橙色准星/数据脉冲图标为本项目原创资产，不使用 Valve 官方 CS2 标志。

---

## 核心功能

### 功能截图

以下截图来自当前桌面端源码的本地演示环境。演示账号与空数据状态仅用于展示界面，不包含真实 SteamID、比赛记录或本机路径。点击图片可查看原图。

<table>
  <tr>
    <td width="50%" align="center"><b>上手指南</b><br><a href="./docs/screenshots/getting-started.png"><img src="./docs/screenshots/getting-started.png" alt="上手指南" width="100%"></a></td>
    <td width="50%" align="center"><b>本地 Demo 库</b><br><a href="./docs/screenshots/demo-library.png"><img src="./docs/screenshots/demo-library.png" alt="本地 Demo 库" width="100%"></a></td>
  </tr>
  <tr>
    <td width="50%" align="center"><b>官匹 Demo 下载</b><br><a href="./docs/screenshots/official-demo-download.png"><img src="./docs/screenshots/official-demo-download.png" alt="官匹 Demo 下载" width="100%"></a></td>
    <td width="50%" align="center"><b>解析后默认计分板与全场评级</b><br><a href="./docs/screenshots/demo-analysis.png"><img src="./docs/screenshots/demo-analysis.png" alt="解析后默认计分板与全场评级" width="100%"></a></td>
  </tr>
  <tr>
    <td width="50%" align="center"><b>可重新打开的历史分析</b><br><a href="./docs/screenshots/analysis-history.png"><img src="./docs/screenshots/analysis-history.png" alt="可重新打开的历史分析" width="100%"></a></td>
    <td width="50%" align="center"><b>单局玩家表现与优化方向</b><br><a href="./docs/screenshots/player-assessment.png"><img src="./docs/screenshots/player-assessment.png" alt="单局玩家表现与优化方向" width="100%"></a></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><b>逐回合玩家评价与事件时间线</b><br><a href="./docs/screenshots/round-assessment.png"><img src="./docs/screenshots/round-assessment.png" alt="逐回合玩家评价与事件时间线" width="100%"></a></td>
  </tr>
  <tr>
    <td width="50%" align="center"><b>OBS 录制队列</b><br><a href="./docs/screenshots/recording-queue.png"><img src="./docs/screenshots/recording-queue.png" alt="OBS 录制队列" width="100%"></a></td>
    <td width="50%" align="center"><b>合辑工作台</b><br><a href="./docs/screenshots/montage-workbench.png"><img src="./docs/screenshots/montage-workbench.png" alt="合辑工作台" width="100%"></a></td>
  </tr>
  <tr>
    <td width="50%" align="center"><b>LiteCut 剪辑器</b><br><a href="./docs/screenshots/litecut.png"><img src="./docs/screenshots/litecut.png" alt="LiteCut 剪辑器" width="100%"></a></td>
    <td width="50%" align="center"><b>灵敏度实验室与本地 Steam CFG 预填</b><br><a href="./docs/screenshots/sensitivity-lab.png"><img src="./docs/screenshots/sensitivity-lab.png" alt="灵敏度实验室与本地 Steam CFG 预填" width="100%"></a></td>
  </tr>
  <tr>
    <td width="50%" align="center"><b>磁轴输入实验室</b><br><a href="./docs/screenshots/magnetic-input-lab.png"><img src="./docs/screenshots/magnetic-input-lab.png" alt="磁轴输入实验室" width="100%"></a></td>
    <td width="50%" align="center"><b>设置中心与昼夜模式</b><br><a href="./docs/screenshots/settings.png"><img src="./docs/screenshots/settings.png" alt="设置中心与昼夜模式" width="100%"></a></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><b>2D 雷达回放、玩家选中与单队视角</b><br><a href="./docs/screenshots/2d-replay-preview.png"><img src="./docs/screenshots/2d-replay-preview.png" alt="2D 雷达回放、玩家选中与单队视角" width="100%"></a></td>
  </tr>
</table>

### Demo 库维护

- **本地库记录展示** — 列表、缩略图展示 Demo 的比赛来源、记分板、关注玩家、展示名、备注等关键信息。
- **目录自动监听** — 支持 5E / 完美 / 官匹 demo / faceit 等 Demo 下载目录的监听，一键自动入库。

### 高光解析与片段挖掘

- **批量 Demo 解析** — 支持同时解析大量 Demo 的高光时刻，同一玩家在多场 Demo 中的高光会按场次组织展示。
- **历史分析记录** — 已完成的分析会保存在本地 SQLite 数据库；分析页可直接打开最近记录并复用缓存，不会因为重启软件丢失，也不会为了查看历史重复慢解析。
- **解析后先看计分板** — Demo 基础分析完成后默认打开全场计分板，集中显示比分、K/D/A、ADR、KAST、爆头率、首杀、AWP 与道具伤害，并给每位玩家生成 S–D 评级、优势和优化方向。
- **逐回合玩家评价** — 回合页和 2D 回放结束状态都会展示该回合全部玩家评价，综合击杀、死亡、首杀、爆头和下包/拆包事件。
- **交互式 2D 回放** — 可按回合查看双方站位、移动轨迹、击杀以及烟雾/燃烧范围；点击左右阵容 ID 或地图标记即可选中玩家，选中反馈会在阵容、地图和回合评价之间同步。
- **单队战术视角** — 可切换全局、仅 A 队或仅 B 队，过滤另一队的位置、轨迹、弹道和投掷物。该功能用于战术复盘，不声称模拟游戏内真实视线遮挡。
- **目标玩家锁定** — 自动识别对局内全部玩家，按 Steam ID、平台 ID 或昵称定位目标，兼容 5E、完美世界、官匹等不同 Demo 导出习惯。
- **细粒度高光分析** — 自动分出 **高光**（多杀、颗秒、残局、刀杀、跳杀、拆包等）、**下饭**（电击枪、沙鹰、队友误伤及「人肉吸铁石」「人体描边」「肩并肩」等名场面）、**跨回合合集**（亲儿子喂饭、本命苦主、全场击杀/死亡串烧、按回合连续录制），以及 **梗局**（211 / o / i / z 系列研发标签，可配 AI 整局总评）。标签说明见 [片段类型与标签](./docs/highlight_tags.md)。
- **回合时间线** — 除自动挖出的片段卡片外，可按回合浏览击杀/死亡时间线，把某一枪、某一死或整回合画面直接加入录制队列。
- **回合连续录制** — 支持从回合开局录到死亡或回合结束，可勾选若干回合拼成一条长片。

> **关于首次解析耗时：** “Demo 基础分析”和“2D 回放缓存生成”是两个阶段。首次进入某场 Demo 的 2D 回放时，程序还需要生成整场 Parquet、当前回合二进制轨迹及烟雾/燃烧效果缓存，因此第一次会比再次打开更慢；缓存命中后会直接读取本地结果。升级版本不会删除 `%APPDATA%\CS2 Insight Agent\data\cache\demo-replay` 中已有的回放缓存。

### 视频介绍

- 产品介绍视频正在重新制作，当前 Release 暂不提供旧版视频。

### 训练与输入实验室

- **个性化灵敏度诊断** — 结合无点击甩枪和连续追踪结果，判断当前灵敏度偏快、偏慢、接近平衡，或甩枪与追踪偏好不一致；同时给出调整百分比、CS2 可直接使用的 `sensitivity` 命令和建议复测区间。
- **本机 CS2 CFG 预填** — 以只读方式扫描本地 Steam 账号的 CS2 配置，预填当前灵敏度、分辨率和画面比例；DPI 与显卡拉伸模式仍由用户确认。
- **磁轴参数优化** — 根据异常重复边沿、保持抖动、A/D 重叠和方向切换延迟，分别给出触发行程、RT 按下及 RT 抬起的建议起点，并要求每次仅调整 `0.05–0.10 mm` 后复测。
- **官匹输入安全提醒** — 普通 Rapid Trigger 可用于缩短按键复位；在 CS2 官匹中应关闭 Snap Tap、Rapid Tap、Snappy Tappy、SOCD/LKP 等自动反向输入功能。

### 自动录制

- **批量录制队列** — 多场比赛、多个片段排队，程序依次启动 CS2 回放并驱动 OBS 成片；录制前可预览整批计划，队列里也可微调每段的节奏。
- **录制前观战设置** — 一键配置观战 HUD（仅死亡通知、隐藏 ID/聊天/Demo 条）、视野与持枪角度、闪光亮度、语音、分辨率与画幅、片段之间的 OBS 转场等；本场也可临时打开实验性 POV 第一人称 HUD。
- **多样化成片风格**：
  - 裁判视角或 POV 第一人称 HUD（可隐藏/显示雷达、调整正上方人数条）
  - 纯净观战画面、自定义 FOV、隐藏投掷物轨迹
  - **受害者视角** — 高光或多杀合集可在你的主视角之后，自动追加被击杀者视角片段
  - **按键显示叠加** — 在 OBS 里叠加 WASD、蹲跳等按键提示，与画面不同步时可手动微调
  - **击杀特效叠加** — 在颗秒、复仇、穿墙、盲狙、一石二鸟及多杀/残局发生时，由 OBS 自动叠加带透明通道和声音的特效视频
  - 片段之间淡入淡出等转场
- **安全录制方案**：
  - 通过 OBS 与游戏状态联动控制录制，不注入、不 Hook 游戏进程
  - 自动备份并在录制结束后恢复你的键位与画面设置


### 合辑工作台

- 录制成功的片段自动入库，可在合辑工作台拖拽排序、配 BGM / 转场主题，导出 MP4；支持按高光/下饭/合集/时间线等类型筛选，以及片头片尾编排。
- **玩家信息卡** — 导出时可开启左下角名牌：每段画面开头短暂显示该片段对应玩家昵称、高光/下饭/合集类型、回合与情景标签（如多杀、颗秒等）；可为时间线里出现的每位玩家单独上传头像，不上传则显示昵称首字。适合 B 站式集锦片头标注，无需后期在 PR 里逐条加字。
- **使用前需配置 FFmpeg**：前往 [FFmpeg 官网](https://ffmpeg.org/download.html) 或 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 下载 Windows 构建包，解压后在程序设置页面的「FFmpeg 路径」中填入 `ffmpeg.exe` 的完整路径。导出时会优先使用显卡硬件编码（NVENC / QSV / AMF），没有则使用软件编码。


### AI 锐评（可选）

- **OpenAI 兼容多家厂商** — 内置 DeepSeek、通义 Qwen、智谱 GLM、MiniMax、OpenAI、OpenRouter；本地模型支持 Ollama、LM Studio。
- **毒舌人设 Prompt** — 高光吹爆、下饭嘲讽、梗死亡当段子；硬约束 100 字以内、单行 JSON 输出，不输出场外废话。
- **整局梗合集总评** — 211/o/i/z 系研发局会触发「整局综合评价」，独立于片段级评分。

---

## 安装

前往本仓库的 [Releases 页面](https://github.com/INEEDBUG/CS2-Ultimate-Insight-Studio-Private/releases) 下载最新的 `CS2 Ultimate Insight Studio_x.x.x_x64-setup.exe`，双击运行安装包，按提示完成安装。

安装完成后从桌面或开始菜单启动程序，**无需打开浏览器，无需手动启动后端**。轻量 Tauri 桌面壳会自动启动内嵌 Python 后端，并使用 Windows 系统 WebView2 显示界面。

源码开发需先安装 `uv 0.11.x`，然后运行
`.\packaging\demoparser-lean\setup-backend-dev.ps1`。脚本会依据仓库根目录的
`uv.lock` 创建 Python 3.12 环境并安装经过哈希锁定的依赖。项目的高速 2D
回放使用 PyO3 编译的定制 `demoparser2` Rust 扩展；后端会在启动阶段验证
所需 Rust 接口，不会使用 PyPI 原版解析器静默降级。

依赖边界保持独立：Python 后端使用 `uv`/`uv.lock`，前端与 Tauri JS
工具链使用 `pnpm`/`pnpm-lock.yaml`，Rust 桌面壳使用 `cargo`/`Cargo.lock`；
OBS 与 FFmpeg 仍由各自的运行时集成管理。

当前不运行后台自动更新器；需要升级时，请直接从[本项目 Releases 页面](https://github.com/INEEDBUG/CS2-Ultimate-Insight-Studio-Private/releases)下载新版安装包。

> **建议安装路径不含中文字符。** 例如 `D:\CS2-Insight-Agent\` ✅，`D:\游戏工具\CS2-Insight-Agent\` ❌

---

## Roadmap

- **V1**
   - [X] 高光解析
   - [X] AI 锐评
   - [X] 全自动导播
- **V2**
   - [X] Tauri 轻量桌面端
   - [X] 合辑工作台（FFmpeg 导出）
   - [X] POV HUD 实验性功能
   - [X] 回合时间线浏览与入队录制
   - [X] 录制前观战预热 / 受害者 POV / 虚拟键盘 OBS 叠加
- **V3**
   - [X] Demo 图分析、历史记录与玩家/回合评价
   - [X] 2D 玩家选择与单队战术视角
   - [ ] 战术教练（投掷物轨迹分析 / 路线复盘）


### 上游贡献者

<a href="https://github.com/DrEAmSs59/CS2-insight-agent/graphs/contributors">
  查看 `DrEAmSs59/CS2-insight-agent` 的贡献者与原始提交历史
</a>


---

## License

本项目采用 [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) 协议发布。

- 允许个人学习、研究、爱好、评测及其他非商业用途使用。在遵守本协议的前提下，你可以阅读、修改、构建和分发本项目源码及其衍生版本。
- 未经书面授权，禁止将本项目或其衍生版本用于任何商业用途，包括但不限于：商业软件、付费服务、商业代剪/代录服务、商业平台集成、对外销售、出租、转售或作为商业产品的一部分分发。
- 📦 如果你分发本项目的编译产物、安装包或修改版本，请同时保留本项目的许可证声明，并遵守 `THIRD_PARTY_LICENSES.md` 中列出的所有第三方开源组件许可证。

## 声明

Counter-Strike 2、CS2、Counter-Strike、Steam、Valve 等名称、商标和标识归其各自权利人所有。

本项目与 Valve Corporation、完美世界竞技平台、5E 对战平台、OBS Studio 及其他相关平台或软件的所有者不存在从属、合作、赞助、授权或背书关系。

### 安全使用提示

- **默认录制流程**调用 CS2 时使用 `-insecure` 仅用于本地 Demo 回放，不存在 DLL 注入或 Hook；不会对磁盘上的 `.dem` 做修改，不连接、不修改、不干预任何官方游戏服务器、匹配服务或反作弊系统，也不提供任何作弊、绕过检测或破坏公平竞技的功能，**不要在已登录匹配服务器的 CS2 客户端中并行使用**，以免触发反作弊系统的不必要警示。
- 若你在「常用参数管理 → 实验性功能」中**主动开启 POV**，程序会临时向 CS2 的 `game/csgo` 目录写入 `pov.vpk`，并**增量修改** `gameinfo.gi` 的 `SearchPaths` 以加载 POV HUD 资源；录制结束或异常收尾时会自动恢复。该模式同样**强制**使用 `-insecure` 启动 CS2，**不要用于连接 VAC 安全服务器**。
- 录制期间会临时修改若干 CS2 archive cvar 与按键绑定。本项目会在启动录制时在程序数据目录的 `.cs2_config_backup` 中**自动备份**玩家原始的 `config.cfg` / `video.txt` / `user_convars_*.vcfg`，录制结束后会回滚；如遇异常退出导致设置被覆盖，可在该目录手动取回原始文件。
