# Rating Pro 2.0 / 3.0 方法说明

Rating Pro 是本项目根据本地 Demo 事件生成的透明估算模型，不是 HLTV 官方 Rating，也不会联网抓取或冒充 HLTV/CSStats 的比赛结果。

## Rating Pro 2.0

模型以 1.00 为中性基准，分别估算击杀、存活、KAST、伤害和影响五个等权分项。各项先按 T/CT 侧使用不同公开原则基准换算为标准差偏离，再按本场两侧回合数合并；影响分项使用多杀、首杀/首死、残局胜利、助攻与补枪。

Rating Pro 2.0 当前实际遵循的是 HLTV 2.1 对 CS2/MR12 的公开修正思路：

- 输掉回合时，没有击杀或助攻的纯保枪不再获得 KAST 点；
- 失利回合存活只获得折减后的生存贡献；
- 被及时补枪的死亡获得部分生存质量补偿；
- 五个分项等权，避免旧 CS2 环境中过度奖励存活与 KAST。

设计维度参考 HLTV 对 Rating 2.0/2.1 的公开说明；HLTV 明确没有公开精确公式、标准差和攻守方常数，因此软件始终显示“本地估算”。

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
- [HLTV: Introducing Rating 2.1](https://www.hltv.org/news/40051/introducing-rating-21)
- [HLTV: Introducing Rating 3.0](https://www.hltv.org/news/42485/introducing-rating-30)
- [HLTV: Rating 3.0 adjustments go live](https://www.hltv.org/news/43047/rating-30-adjustments-go-live)
