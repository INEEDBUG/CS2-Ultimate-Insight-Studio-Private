# CS2 Ultimate Insight Studio 开发记录

## 项目边界

- 主体基于 `DrEAmSs59/CS2-insight-agent`，保留其 PolyForm Noncommercial 1.0.0 许可与原作者声明。
- 参考 `akiver/cs-demo-manager` 的成熟工作流，但不复制其 PostgreSQL 数据层；当前项目继续使用已有 SQLite 数据库。
- 功能分阶段落地：官匹 Demo 获取与自动入库 → 分析/回放整合 → 灵敏度测试与个性化建议 → 磁轴键盘测试与关联分析。
- GitHub 仓库在开发完成前保持 Private；转为 Public 必须由项目所有者再次明确确认。

## 2026-08-02：阶段 1 — Share Code 下载垂直切片

已完成：

- 建立私人仓库 `INEEDBUG/CS2-Ultimate-Insight-Studio`，保留 `upstream` 指向原项目。
- 将用户提供的 `steam://rungame/...+csgo_download_match CSGO-...` 输入规范化并解码为 match ID、reservation ID 和 TV port。
- 通过独立、按需下载的 `@akiver/boiler-writter` 与本机 Steam Game Coordinator 通信，读取 Valve 返回的真实 `.dem.bz2` 地址。
- 对 npm 包做固定版本和 SHA-512 完整性校验，只提取白名单文件。
- 下载后原子解压为 `.dem`，沿用原项目的 Demo 监听目录与自动入库队列。
- 在官匹战绩页加入分享代码/Steam 链接输入、首次使用许可确认、成功与错误状态。
- 后端全套 683 项测试通过，前端全套 584 项测试及生产构建通过。

尚未完成：

- 在真实 Steam 登录环境中做端到端试运行；该步骤会实际下载并运行可选组件，需要用户在界面确认并关闭 CS2。
- 完善下载进度、取消、重试和已过期诊断。
- 开始灵敏度生成器及磁轴输入测试模块。

## 技术决定

1. 数据库继续使用项目现有 SQLite，不引入 PostgreSQL。
2. GPL-3.0 helper 不链接进 Python/Tauri 主程序，保持独立进程与独立许可文件；发布前仍需做一次完整许可证复核。
3. 不再使用由 match ID 猜测 replay 服务器的 URL 作为 Share Code 下载依据，改用 Steam Game Coordinator 返回值。

## 2026-08-02：阶段 2 — CS2 灵敏度实验室

已完成：

- 新增本地 SQLite `sensitivity_sessions` 表，保存测试输入、推荐结果、分辨率背景和置信度。
- 新增 Touch Grid 无点击甩枪测试：准星碰到目标即触发，统计反应时间、路径效率与过冲。
- 新增 Orbit Track 连续追踪测试：目标持续移动，统计有效追踪时间、平均距离和脱靶次数。
- 每轮使用 `performance.now()` + `requestAnimationFrame` 驱动独立倒计时；Pointer Lock 成功后才计时，Esc/失焦自动暂停并可恢复。
- 比较当前灵敏度的 0.8×、1.0×、1.2×，使用 CS2 `m_yaw 0.022` 生成游戏可直接使用的 sensitivity、eDPI、cm/360 和控制台命令。
- 游戏分辨率（默认用户实际使用的 1024×1080）、显示比例和拉伸方式进入测试上下文；不使用无依据的固定“分辨率灵敏度修正”。
- 中英文页面、本地历史记录和一键复制控制台命令已接入主导航。

验证：

- 后端全套 687 项测试通过。
- 前端全套 587 项测试通过，生产构建通过。
- 在本地浏览器完成 1024×1080 默认设置、靶场进入、鼠标锁定失败保护、退出恢复与视觉布局检查。
