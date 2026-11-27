# CalendarBench 学习素材包 v1

本包有 **8 份原文配置摘录**，以及 **3 组 × 宽松／紧张 = 6 份研究者改编的单日学习场景**。
8 份摘录不是 8 个独立任务样本；6 份场景不是从原数据集抽到的已生成日程。具体任务内容和所有数值均在来源说明中区分。

## 从哪里看

- `素材总览.html`：直接打开浏览原文卡片与六份任务表。
- `原文摘录/`：原样截取 YAML，行号与链接见 `来源清单.json`。
- `原始来源/`：固定提交的完整配置快照与原 MIT 许可证。完整学生模板仅用于核对上下文，其人格、情绪等合成设定没有导入场景。
- `改编场景/`：每份各有 Markdown 与 JSON。JSON 是研究材料格式，不是现有服务器的一键导入格式。
- `任务总表.csv`、`六份候选场景.json`：合并材料；CSV 共 30 行，配对重复属于设计，不是 30 个独立任务。
- `校验/可行性检查.json`：约束核查及研究者参考可行安排。不要将这些安排作为推荐答案展示给参与者。
- `整理与校验.py`：无需第三方依赖，可从本包的来源快照重建并核查。

## 六份候选素材

|编号|场景|约束|任务数|任务分钟|净可用分钟|余量|
|---|---|---|---:|---:|---:|---:|
|[S1-L](改编场景/S1-L.md)|课程学习日|宽松|5|240|390|150|
|[S1-T](改编场景/S1-T.md)|课程学习日|紧张|5|240|270|30|
|[S2-L](改编场景/S2-L.md)|考前复习日|宽松|5|240|390|150|
|[S2-T](改编场景/S2-T.md)|考前复习日|紧张|5|240|270|30|
|[S3-L](改编场景/S3-L.md)|课程报告准备日|宽松|5|240|390|150|
|[S3-T](改编场景/S3-T.md)|课程报告准备日|紧张|5|240|270|30|

## 原文摘录索引

- **E01 通用示例：学习活动目录**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/example_experiment/event_config.yaml#L77-L91)。包含 lecture、self-study 等标签；单次 1–8 小时是该示例的生成范围，不是教学建议。
- **E02 学生实验：学习活动目录**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/healthy_lifestyle_promotion/event_config.yaml#L103-L128)。包括 lecture、course、self-study、exam、quiz 等日历标签；单次通用范围 1–3 小时。标签不等于独立题本。
- **E03 学生实验：学习阅读目录**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/healthy_lifestyle_promotion/event_config.yaml#L129-L143)。通用单次范围 5–60 分钟；定义可拆分性和可出现的时间段。
- **E04 学生模板：学习阶段**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/healthy_lifestyle_promotion/persona_config.yaml#L1240-L1243)。模板将学习活动关联到工作日 10:00；这是合成人物设定，不是参与者实测偏好。
- **E05 学生模板：学习时长覆盖**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/healthy_lifestyle_promotion/persona_config.yaml#L1317-L1322)。人物覆盖配置：单次 120–240 分钟，每日总量 240–420 分钟，2–3 段；不能只引用 E02 忽略覆盖。
- **E06 学生模板：阅读时长覆盖**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/healthy_lifestyle_promotion/persona_config.yaml#L1360-L1365)。人物覆盖配置：单次 60–150 分钟，每日总量 120–240 分钟，1–2 段；这些合成参数未在我们的学生群体中验证。
- **E07 环境：时间段定义**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/healthy_lifestyle_promotion/environment.yaml#L17-L25)。定义早晨、下午等时间段，以及场景任务的起止范围；不是特定学生的空闲时间。
- **E08 学生模板：阅读阶段**：[原文](https://github.com/MaaniBeigy/calendar-bench/blob/2c823c234d7c25bae7f603d74eb8fd7d522b7243/src/experiments/persona/healthy_lifestyle_promotion/persona_config.yaml#L1300-L1303)。学习阅读出现于人物阶段设置；与 E03/E06 是同类活动的不同配置层，不是新样本。

## 如何选用

建议先看 S1 课程学习日的一对；S2、S3 是语义不同的备选，不要求每位参与者全部评价。三组时间结构有意保持相同，不能当作三种独立约束强度。
宽松／紧张同时改变可用时间和部分截止时间。本设计只比较总体约束强度，不能单独判断是哪一种约束造成差异。紧张程度的主观操纵检查仍未完成。
同一学习任务清单重复出现可能有熟悉效应，正式实验需处理呈现顺序；是否使用同任务配对或匹配的不同内容，需要和整体实验设计一起确定。
当前只写清交付物，不提供可直接考试的学科题目或教材。选定课程后，必须补齐具体学习材料并验证估时。Profile 和感知难度由参与者提供。
固定午休和两次短休息用于统一最低休息条件；如研究重点包含自由休息偏好，应另行调整这条共同规则并重新检查可行性。
优先级、15 分钟拆分粒度、所有具体任务时长和窗口是本项目设计值，不是原论文验证过的标准；未按 HumanOS 得分或优势筛选。

## 校验范围

逐组检查配对任务内容、时长、优先级和共同规则一致；检查全部 120 种任务排列在不拆分且尽早放置规则下的可行性；独立复核每份保存的三个可行安排。存在多个可行顺序不等于证明个人偏好能被满足。
未运行 CalendarBench 生成器、未调用 LLM、未测量 HumanOS 效果、未采集参与者数据。

## 来源

CalendarBench 仓库：https://github.com/MaaniBeigy/calendar-bench；提交 `2c823c234d7c25bae7f603d74eb8fd7d522b7243`。
本包的原文配置来自开放仓库，保留原 MIT 许可证。该许可声明不自动覆盖外部本体或其他数据源。
