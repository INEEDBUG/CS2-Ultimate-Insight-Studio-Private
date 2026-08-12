# Estimated HLTV Rating 2.0 / Rating Pro 3.0 方法说明

Rating Pro 是本项目根据本地 Demo 事件生成的透明估算模型，不是 HLTV 官方 Rating，也不会联网抓取或冒充 HLTV/CSStats 的比赛结果。

## Estimated HLTV Rating 2.0

界面中的 `Est. R2` 采用公开社区逆向估算式：

`0.0073 × KAST + 0.3591 × KPR - 0.5329 × DPR + 0.2372 × Impact + 0.0032 × ADR + 0.1587`

其中 `Impact ≈ 2.13 × KPR + 0.42 × APR - 0.41`。这解决了旧模型把完整比赛再次向 1.00 收缩、导致高输出局被明显低估的问题。项目使用用户提供的 csstats.gg 十人记分板作为固定回归样本，结果与其 `Estimated HLTV Rating 2.0` 显示值相差不超过 0.01。

HLTV 明确没有公开实际生产公式、攻守方常数和所有细节，因此这里始终显示 `Estimated`，不会冒充 HLTV 官方评分。失利纯保枪、回合经济和 Swing 等修正保留在 RP3，不再混入 Est. R2，便于与外部 Estimated R2 工具直接对照。

## Rating Pro 3.0

在上述基础上加入：

- 经济修正：按发生击杀的具体回合比较双方装备，而不是只比较全场平均；劣势装备输出适度加权，优势经济收割适度折减；
- 多杀分项：一杀到五杀使用递增但有上限的爆发贡献；
- Round Swing 代理：按每次击杀前后的存活人数、攻守方和回合经济估算胜率变化；击杀者获得主要贡献，伤害份额代理、补枪和闪光助攻参与分配；
- 回合结束贡献：以较低且封顶的权重，把剩余影响分给产生正向 Swing、完成残局/拆包或存活的胜方玩家；
- 小样本收缩：单回合或极短比赛的结果向 1.00 收缩，避免一次 ACE 直接生成不可信的极端分数。

2025 年 10 月 HLTV 热修后，Rating Pro 3.0 使用 28% 击杀、19% 伤害、18% 生存、17% KAST、8% 多杀和 10% Swing 的透明权重。把 Swing 一半视为输出、一半视为代价时，整体约为 60:40；这对应 HLTV 公开的“提高击杀、降低 Swing 与多杀，恢复 60:40”方向，但不是其私有系数。

HLTV Rating 3.0 的官方模型还使用地图级历史胜率、个人武器装备、精确逐次伤害份额、HP、位置、闪光助攻和补枪等更完整的历史分布。项目能读取攻守方、团队回合装备、击杀、补枪和部分闪光助攻，但没有 HLTV 私有训练数据，因此 Rating Pro 3.0 主要用于同一场本地 Demo 内的横向比较。

## 英雄与战犯

- 本局英雄：从胜方选取 Rating Pro 3.0 最高的玩家；平局时从全场选取。
- 本局战犯：从负方选取 Rating Pro 3.0 最低的玩家；平局时从全场选取。
- 标签是复盘用的娱乐化摘要，不用于判断作弊、人格或长期水平。

## 公开参考

- [HLTV: Introducing Rating 2.0](https://www.hltv.org/news/20695/introducing-rating-20)
- [Reverse Engineering the HLTV 2.0 Rating](https://dave.xn--tckwe/posts/reverse-engineering-hltv-rating/)
- [HLTV: Introducing Rating 2.1](https://www.hltv.org/news/40051/introducing-rating-21)
- [HLTV: Introducing Rating 3.0](https://www.hltv.org/news/42485/introducing-rating-30)
- [HLTV: Rating 3.0 adjustments go live](https://www.hltv.org/news/43047/rating-30-adjustments-go-live)
