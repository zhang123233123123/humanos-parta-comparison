# Part A 单日四条件比较工具

2026-11-25，内部预试版本已部署。线上入口：https://humanos.hongjianzhangstools.me/part-a 。本地前后端已停止，代码、素材和运行记录保留。

## 操作

1. 使用专属访问链接进入，无需注册或登录。链接保存在被 Git 忽略的 `webapp/qa-local/parta-direct-access.json`，浏览器访问权限保留7天，过期后再次打开原链接。直接打开普通 `/part-a` 且没有访问权限时会提示使用专属链接。
2. 选择六份素材之一、18 份历史 Profile 之一。页面显示该人的**第一阶段首次设置的第一天**，不是今天，也不是第二阶段的第一天。
3. 难度选一种表达：高／中／低、0–100 整数分、主观文字。逐任务填写，第三与第四条件接收完全相同的难度；不会自动从等级换算分数。分数越高表示感觉越难。
4. 按需要修改本次任务时长与每项任务的当天截止时间（HH:mm），旁边保留原截止供核对。截止须晚于该任务最早开始、最晚23:59；不跨天。四条件共用修改后的时间，原素材不被覆盖，任务内容与优先级保持不变。修改后必须重新预览。
5. 点击“检查时间并预览提示词（不调用模型）”。展开每份请求查看实际初次 messages、模型和参数。展开共同上下文核对任务、日期、可用窗口和固定事项。
6. 时间必要条件通过后点击“确认配置并调用模型生成”。后端四条件异步运行，页面自动更新；单次请求超时取现有模型配置90秒，每个条件最多三次生成。
7. 展开“第n次”查看真正发出的完整请求体、原始模型内容和校验问题。有效计划显示具体时间、任务和安排理由。初次失败与修正成功分别保留，不把修正结果伪装为首次输出。
8. 刷新页面后默认不显示任何旧结果；从“历史记录”主动打开保存的比较（包括未结束的运行）。“导出完整JSON”包含冻结输入、四条件、提示词、原始输出、校验结果与调用用量。原始输出并非受试者行为或新实验评分。

上方输入编辑不影响下面已经保存的结果，结果区标明它自己的 Profile、素材、日期与运行ID。输入改变后需要重新预览。

## 四个条件

|条件|共同任务/时间|单日规划指令|难度|工作方式Profile|
|---|---|---|---|---|
|AI-native|有|通用学习规划指令|无|无|
|Task-only|有|HumanOS 单日提示词 v1|无|无|
|Task + difficulty|有|同上|有|无|
|HumanOS|有|同上|与③相同|有|

当前的 HumanOS 单日提示词是此预试工具的显式版本，保存在 `planning.py` 的 `GUIDANCE`、`OUTPUT`；不是主产品周排程器的所有历史上下文。四个条件均要求相同 JSON 结构、同一模型/temperature=0.2、关闭thinking、最多3次。首次生成不通过时，将同一校验器的问题交回原条件模型；这是“通用指令＋共同时间质检”的比较，不能称完全不加指令的模型实验。正式研究需要据此冻结条件及修正政策。

工作方式 Profile 使用典型早中晚精力、专注块分钟、休息分钟、任务切换和补充偏好。历史未采集的顺序、自然停点、休息形式和例外不补造。典型精力不是当天实时状态；个人偏好是软目标，硬时间检查对四条件完全一致。

## 时间规则

- 取原始 `setup_start` 日期及其时区，当日个人可用时段与固定事项作为四条件共同约束。
- 素材任务的最早开始与本次截止钟点锚定到上述日期；素材午休与固定休息也保留。
- 原宽松/紧张素材标签不保证替换为个人时间后的约束强度。页面展示总工作量与净可用分钟；截止前的联合工作量不足也会拦截。生成按钮旁会重复显示具体原因，便于核对时长或截止。
- 必要条件通过不保证一定存在满足所有细节的解；模型生成后还会做完整校验。
- 复用原 `domain/simulation/planning.py::validate_blocks` 及其时间窗口引擎，额外检查当天范围、整分钟、最小块、完整工作量、不可拆分与前置依赖。仅规范化时间表示，不改变实际时间点。
- **不使用 Python 自动排程修补模型。** 校验不通过返回问题给模型；三次仍不通过显示失败，不作为有效计划。
- “时间校验通过”只表示硬约束可行，不等于个性化更好、用户满意或研究假设得到支持。

## 接口与保存

前端同源代理：`/api/part-a/*`。后端对应 catalog、preview、runs、runs/{id}。浏览器不直接调用8787，也不持有LLM密钥。链接路由将令牌写入HttpOnly、Secure（HTTPS）、SameSite=Strict的Cookie后跳转普通入口；页面与API均重新校验令牌，POST另校验Origin，后端仍验证代理HMAC签名。

每组比较存入 `webapp/backend/data/parta-pretest.sqlite3` 的 `parta_runs`；不写真实用户任务/日历。记录归属该专属链接的独立工具主体；同一链接的使用者共享比较记录。它不是产品用户账号，也不授予工作台访问权限。最大两组比较运行中，模型调用线程上限4。网络响应丢失时，相同request_id返回原记录，避免重复调用。服务重启时未完成项标为interrupted，已有输出保存，不自动续跑消耗额度。

## 本地启动与配置

在已有 Python / Node 依赖环境下，分别启动：

```sh
cd webapp
./backend/.venv/bin/python backend/humanos_server.py
```

```sh
cd webapp/frontend
npm run dev -- --hostname 127.0.0.1
```

后端 `.env`：已有的 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL=https://llmapi.fiblab.net/v1`、`DEEPSEEK_MODEL=deepseek-v4-flash`、`DEEPSEEK_TIMEOUT_SECONDS=90` 沿用。不要把API密钥写入前端或研究材料。

两端配置：`HUMANOS_PARTA_MODE=1`、相同的随机 `HUMANOS_PARTA_PROXY_SECRET`（至少32字符）、相同的 `HUMANOS_PARTA_LINK_ACTOR`（`parta_link_` 加32位随机十六进制）。前端额外设置 `HUMANOS_PARTA_LINK_HASH` 为随机访问令牌的 SHA-256。专属链接为 `/part-a/access/<token>`，令牌使用至少32个随机字节生成的 base64url 字符串。线上旧账号白名单 `HUMANOS_PARTA_RESEARCHERS` 已清空。更新配置后重启相关进程；更换令牌hash会使旧链接与旧Cookie失效，保持actor不变可保留原记录归属。

素材默认从仓库根目录 `PartA预实验/` 读取；移机可设后端 `HUMANOS_PARTA_MATERIALS` 为绝对目录。需要 `任务素材/改编场景/*.json`、`Profile素材/正式实验18人_首次Profile.json`。

密钥、专属链接文件、SQLite都被Git忽略。尚未配置时默认关闭此工具；没有有效链接访问权限不会返回历史Profile。不要把真实研究素材放入public目录。

## 检查命令

```sh
cd webapp
PYTHONPATH=.:backend ./backend/.venv/bin/python -m unittest backend.test_part_a backend.test_scheduler_constraints backend.test_simulation_http.SimulationHTTPTests.test_identity_and_ordinary_routes_are_blocked -q
```

```sh
cd webapp/frontend
npx tsc --noEmit
npm run build
```

旧 `test_simulation_http` 的 `test_documents_answers_failure_and_export` 仍调用已移除的场景发布接口，得到410；这与本次工具无关，本次未恢复旧接口或修改该旧测试。适用的鉴权检查和时间约束测试单独运行。

### 自主启动说明

打开页面不会自动选择任务/Profile或填入难度，也不会自动展示历史结果。必须由研究者填写并预览后主动点击生成。页面原先显示的A02/S1-L是开发者工程测试（难度中/高/低/高/低），不是用户输入，也不支持效果结论；现仅作为本地可手动查看的历史记录保留；没有上传到线上运行库。后续开发验收不自行调用付费模型。

### 截止时间覆盖字段

预览与生成请求均支持可选 `deadline_overrides`，例如 `{"S1-01":"18:30"}`。省略某项沿用原截止；空值、非HH:mm格式、越界、未知任务ID以及不晚于最早开始的截止返回400。有效修改进入四条件共同上下文、时间校验、冻结输入和JSON导出；旧预览hash不可用于修改后的生成请求。读取历史记录仍展示该记录保存时的时间，不会跟随当前编辑变化。
