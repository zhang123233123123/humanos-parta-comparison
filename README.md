# HumanOS Part A · 单日四条件比较工具

用于内部预试：选择一份学习任务清单和一份历史 Profile，编辑任务时长、当天截止时间以及难度表达，先检查时间并查看完整提示词，再由研究者手动启动四条件排程比较。

此仓库是 HumanOS 源码提交 `fb80f48` 的范围明确的快照，包含 Part A 及其运行依赖的 HumanOS 前后端模块；不是从头重写的独立调度器。工具入口为 `/part-a`，通过自己生成的专属链接访问，不需要测试账号。

## 四个条件

| 条件 | 共同任务与时间约束 | 排程指令 | 难度 | 工作方式 Profile |
|---|---|---|---|---|
| AI-native | 有 | 通用规划指令 | 无 | 无 |
| Task-only | 有 | HumanOS 单日指令 | 无 | 无 |
| Task + difficulty | 有 | HumanOS 单日指令 | 有 | 无 |
| HumanOS | 有 | HumanOS 单日指令 | 与上一条件相同 | 有 |

四条件使用相同模型与校验规则；首轮并发，失败的时间校验可交回原条件模型修正，每条件最多3次。预览不调用模型。模型输出、实际请求、修正记录与用量保存在独立 SQLite，支持 JSON 导出。时间校验通过不等于个性化优势或研究假设成立。

## Prompt 和核心代码

- [排程提示词及四条件组装](webapp/backend/app/application/part_a/planning.py)：`GUIDANCE`、`OUTPUT`、`build_preview`。
- [并发生成、修正提示词与保存](webapp/backend/app/application/part_a/service.py)。
- [模型传输与请求记录](webapp/backend/app/infrastructure/part_a_runtime.py)。
- [前端比较页](webapp/frontend/src/components/part-a/workbench.tsx)。
- [操作与时间规则说明](webapp/backend/docs/part-a-pretest-guide.md)。文中原项目部署路径属于来源背景，新环境按下面步骤配置。

## 本地运行

需要 Python 3.11+、Node.js 20+。从仓库根目录执行：

```sh
python3 -m venv webapp/backend/.venv
webapp/backend/.venv/bin/pip install -r webapp/backend/requirements.txt
npm --prefix webapp/frontend ci
python3 scripts/init-local-config.py
```

初始化脚本生成本地私有配置和访问链接，不创建用户，不调用模型，已有配置时拒绝覆盖。将自己的 API key 填入 `webapp/backend/.env` 的 `DEEPSEEK_API_KEY`。默认模型网关为 `https://llmapi.fiblab.net/v1`，模型 `deepseek-v4-flash`；模型可用性取决于你的网关权限。

分别在两个终端启动：

```sh
cd webapp
backend/.venv/bin/python backend/humanos_server.py
```

```sh
cd webapp/frontend
npm run dev -- --hostname 127.0.0.1
```

打开初始化脚本输出的专属链接。依次选择任务和 Profile、填写难度、调整时长/截止、预览，然后主动点击生成。四条件共用所选 Profile 首日的可用时间、固定事项及本次任务截止；原素材不被覆盖。改变输入后必须重新预览。

部署时将 `NEXTAUTH_URL` 改为自己的 HTTPS 域名，并正确设置 `HUMANOS_BACKEND_URL`。浏览器只访问同源 `/api/part-a/*`，后端代理签名由前后端共享配置校验。无需复制原项目服务器配置或账号。

## 素材与数据

- [6份学习场景](PartA预实验/任务素材/改编场景/)及对应原始来源、说明与许可一并保留。
- [18份历史 Profile 首次记录](PartA预实验/Profile素材/正式实验18人_首次Profile.json)用于内部预试；有来源与筛选说明。它们不是对新任务采集的实验结果，缺失维度不补造。
- 本仓库保持私有；运行数据库、模型密钥、原站点专属访问链接、登录凭据、服务器备份和其他研究文档不包含在内。
- 运行生成的 `webapp/backend/data/parta-pretest.sqlite3` 被 Git 忽略。

## 检查

```sh
cd webapp
backend/.venv/bin/python -m unittest backend.test_part_a -q
```

```sh
cd webapp/frontend
node scripts/verify-part-a-access.cjs
npx tsc --noEmit
npm run build
```

Part A 版本已有19项后端检查通过，覆盖时间约束、截止修改、冻结输入、重试、记录归属和代理鉴权；原应用生产构建与浏览器交互已验收。此次上传不新增模型实验，不携带生成记录。快照详情见 [SOURCE_SNAPSHOT.json](SOURCE_SNAPSHOT.json)。
