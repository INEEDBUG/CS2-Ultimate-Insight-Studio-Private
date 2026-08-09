# Rating Pro 2.0 / 3.0 方法说明

Rating Pro 是本项目根据本地 Demo 事件生成的透明估算模型，不是 HLTV 官方 Rating，也不会联网抓取或冒充 HLTV/CSStats 的比赛结果。

## Rating Pro 2.0

模型以 1.00 为中性基准，分别估算击杀、存活、KAST、伤害和影响五个分项。影响分项使用多杀、首杀/首死、残局胜利与补枪。设计维度参考 HLTV 对 Rating 2.0/2.1 的公开说明；HLTV 明确没有公开精确公式，因此软件始终显示“本地估算”。

## Rating Pro 3.0

在上述基础上加入：

- 经济修正：装备较差时完成输出获得适度加权，优势经济下的收割适度折减；
- 多杀分项：连续改变人数优势会获得额外贡献；
- Round Swing 代理：按每次击杀前后的存活人数估算回合胜率变化，并结合双方装备价值、助攻和爆头进行轻量修正。

HLTV Rating 3.0 的官方模型还使用地图、攻守方、个人武器装备、伤害份额、闪光助攻、补枪/反补枪等更完整的历史分布。项目当前没有 HLTV 私有训练数据，因此 Rating Pro 3.0 只能用于同一场本地 Demo 内的横向比较。

## 英雄与战犯

- 本局英雄：从胜方选取 Rating Pro 3.0 最高的玩家；平局时从全场选取。
- 本局战犯：从负方选取 Rating Pro 3.0 最低的玩家；平局时从全场选取。
- 标签是复盘用的娱乐化摘要，不用于判断作弊、人格或长期水平。

## 公开参考

- [HLTV: Introducing Rating 2.0](https://www.hltv.org/news/20695/introducing-rating-20)
- [HLTV: Introducing Rating 2.1](https://www.hltv.org/news/40051/introducing-rating-21)
- [HLTV: Introducing Rating 3.0](https://www.hltv.org/news/42485/introducing-rating-30)
- [HLTV: Rating 3.0 adjustments go live](https://www.hltv.org/news/43047/rating-30-adjustments-go-live)
