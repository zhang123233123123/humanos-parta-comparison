export type TourStep = { target: string; title: string; text: string }
const step = (target: string, title: string, text: string): TourStep => ({
  target,
  title,
  text,
})

export const tours: Record<string, TourStep[]> = {
  'participant-setup-context': [
    step(
      'setup-progress',
      '完整的四步设置',
      '依次填写个人情况、工作节奏、可用时间、任务与状态；完成第 4 步后才进入工作台查看计划。',
    ),
    step(
      'profile-role',
      '选择你的学习情境',
      '按实际情况选择；这里的题目和选项来自当前表单。',
    ),
    step(
      'profile-learning_mode',
      '填写学习方式',
      '选择你更常使用的学习材料或方式。',
    ),
    step(
      'profile-planning_failure_reasons',
      '回顾计划受阻的原因',
      '这里可以多选。下面也可以补充一次具体经历。',
    ),
    step(
      'setup-next',
      '保存并进入工作节奏',
      '保存成功后进入第 2 步；这一步不会生成计划。',
    ),
  ],
  'participant-setup-rhythm': [
    step(
      'profile-task_switching_preference',
      '任务安排偏好',
      '选择任务之间如何切换；旁边设置同一任务跨天如何分布。',
    ),
    step(
      'profile-preferred_session_minutes',
      '填写专注与休息时长',
      '可以点常用时长，也可以输入自己的分钟数。',
    ),
    step(
      'profile-typical_energy_morning',
      '拖动填写典型精力',
      '分别填写早晨、下午和晚间的典型精力；拖动滑块或直接输入数值，未填写不算作默认分。',
    ),
    step(
      'setup-next',
      '继续到可用时间',
      '保存前两步后直接填写可用时间和日常活动，无需等待分配。',
    ),
  ],
  'participant-setup-availability': [
    step(
      'setup-dates',
      '先核对具体日期',
      '下面的可用时间和固定活动都需要位于这里显示的时间范围内。',
    ),
    step(
      'setup-availability',
      '选择可用日期和时间',
      '勾选具体日期，修改开始和结束时间；一天有多段空闲时，可以添加其他时段。',
    ),
    step(
      'setup-activities',
      '填写已有活动与日常安排',
      '点击添加活动，选择会议、课程、午餐等，填写日期、时间类型和时段。固定活动会保留，偏好和灵活活动会参与安排。',
    ),
    step(
      'setup-buffer',
      '保留缓冲',
      '勾选后会在扣除固定活动的每段空闲时间末尾保留10%，不将全部可用时间排满。',
    ),
    step(
      'setup-next',
      '保存时间，再填写任务',
      '这一步会保存时间草稿。刷新页面仍可从第 4 步继续；还不会生成计划。',
    ),
  ],
  'participant-setup-tasks': [
    step(
      'setup-add-task',
      '录入你自己的任务',
      '点击“＋ 添加任务”，填写名称、预计总时长、截止时间、难度和认知需求。',
    ),
    step('setup-task-title', '填写任务名称', '用你能识别的名称描述任务。'),
    step(
      'setup-task-minutes',
      '填写预计总时长',
      '这里是整个任务需要的分钟数，系统会按你的工作节奏拆分。',
    ),
    step(
      'setup-task-deadline',
      '填写截止时间',
      '选择本次时间范围内的截止日期和时刻。',
    ),
    step(
      'setup-next',
      '保存任务，再填写当前状态',
      '保存成功后继续填写此刻的状态，随后生成日历草案供你确认。',
    ),
  ],
  'participant-setup-state': [
    step(
      'setup-saved-tasks',
      '任务和时间已经保存',
      '展开核对本次任务及可用时段；下面继续填写当前状态。',
    ),
    step(
      'answer-first',
      '报告此刻的真实情况',
      '回答当前页面的问题；这是此刻的状态，与第 2 步填写的长期精力规律不同。',
    ),
    step(
      'answer-submit',
      '保存状态并生成计划',
      '保存成功后进入工作台等待建议。生成的日历还需要你审核确认。',
    ),
  ],

  'participant-workspace-personal-input': [
    step(
      'scene-tasks',
      '填写你自己的任务',
      '添加任务名称、预计时长、截止时间、难度与需求，可以修改或移除尚未保存的任务。',
    ),
    step(
      'scene-availability',
      '填写自己的可用时间',
      '按具体日期添加能安排任务的时间段，在下面记录午休、会议等固定活动。',
    ),
    step(
      'personal-input-save',
      '保存后再安排',
      '保存成功才更新任务资料。首次保存后填写状态；修改已排任务后，需要重新生成并确认安排。',
    ),
  ],
  'participant-workspace': [
    step(
      'account-id',
      '查看账号编号',
      '这里是你的账号编号，联系组织者核对安排时可以提供。',
    ),
    step(
      'workspace-state',
      '左侧查看今日状态',
      '这里显示你已保存的精力、专注和压力。没有填写时会显示未填写。',
    ),
    step(
      'check-in',
      '情况变化时更新',
      '点击填写新的情况。已有待填写问题时会打开当前弹窗。',
    ),
    step(
      'run-calendar',
      '在原工作台查看日历',
      '顶部可切换日、周、月。待确认建议与已确认计划分开展示；建议需要审核后才能保存。',
    ),
    step(
      'open-review',
      '审核新的建议',
      '先查看日历，再点击这里接受、拒绝或确认拖动修改。',
    ),
    step(
      'workspace-tasks',
      '右侧查看任务安排',
      '当前工作显示已确认的工作段；待安排显示尚未安排的剩余工作量。点击任务查看详情。',
    ),
    step(
      'progress-panel',
      '报告真实进展',
      '完成任务或进度变化时，点击填写剩余分钟数。系统不会仅凭时间经过自动标记任务完成。',
    ),
    step(
      'generate',
      '需要时重新安排',
      '点击请求新的计划建议。按钮不可用时，先完成当前填写、审核或等待生成。',
    ),
    step('toggle-state', '展开或收起状态栏', '小屏幕可点击这里打开左侧状态。'),
    step(
      'toggle-tasks',
      '展开或收起任务栏',
      '小屏幕可点击这里打开右侧任务和重新安排按钮。',
    ),
  ],
  'participant-workspace-review': [
    step(
      'review-panel',
      '检查调整说明',
      '核对日历与说明；有未安排工作时，请确认是否保留。收起面板可回到日历拖动建议。',
    ),
    step(
      'review-accept',
      '确认后保存',
      '接受建议或确认拖动修改后，后端会校验并保存。失败时原计划保留。',
    ),
    step(
      'review-reject',
      '也可以拒绝',
      '不适合时可填写原因并拒绝，原已确认计划保留。',
    ),
  ],
  'participant-workspace-progress': [
    step(
      'workspace-progress',
      '填写剩余工作量',
      '只填写有变化的任务，完成填 0，留空不更新。保存后系统重新评估安排。',
    ),
  ],
  'participant-workspace-details': [
    step(
      'workspace-dialog',
      '查看已保存的信息',
      '查看任务或个人资料。右上角关闭后回到工作台。',
    ),
  ],
  'profile-editor': [
    step(
      'question-title',
      '编辑原 Profile 字段',
      '这里直接修改参与者首次填写的题目，原字段可以停用但保留标识。',
    ),
    step(
      'profile-save',
      '保存并应用配置',
      '新开始填写的参与者使用此版本；已有答案保留当时题目和选项。',
    ),
  ],
  'research-lobby': [
    step(
      'edit-profile',
      '先配置原 Profile',
      '直接编辑原有字段。参与者首次登录会填写，不需要先分配场景。',
    ),
    step(
      'new-config',
      '① 准备要问的问题',
      '点击这里新建问题方案。可以修改心情与状态、每日反馈、节点问题、计划反馈和结束评价；进入编辑页后会有对应指引。',
    ),
    step(
      'run-list',
      '从这里继续已有会话',
      '点击工作台记录查看填写进度、AI 返回的节点和数据导出。日常工作台只提供节点启用／停用，不需要分配场景。',
    ),
  ],
  'participant-lobby': [
    step(
      'account-id',
      '查看你的账号编号',
      '这是你的账号标识，研究者可据此查找本轮记录。',
    ),
    step(
      'run-list',
      '查看自己的工作台',
      '完成首次设置后即可进入工作台。这里显示你已保存的工作记录。',
    ),
  ],
  'configs-editor': [
    step(
      'config-name',
      '给问题方案起名',
      '用容易辨认的名称区分你要测试的不同问题组合。',
    ),
    step(
      'question-title',
      '修改参与者看到的问题',
      '这里可直接修改题目。下面还可以填写说明、设定选项和量表锚点。',
    ),
    step(
      'question-phase',
      '决定什么时候提问',
      '选择初始状态、每日反馈、节点询问、计划反馈或结束评价，决定题目出现的位置。',
    ),
    step(
      'question-type',
      '选择回答方式',
      '可以使用文本、数字、单选、多选或量表。修改后请预览表单，检查填写方式。',
    ),
    step(
      'question-usage',
      '决定答案如何使用',
      '排程、节点判断、两者共用或仅供评价。仅供评价的答案不会送进模型调用。',
    ),
    step(
      'question-add',
      '需要更多问题时添加',
      '新增后再设置题目、展示阶段与答案用途；也可以调整已有题目的顺序或启用状态。',
    ),
    step(
      'editor-preview',
      '预览参与者的表单',
      '点击预览检查显示效果。预览中的回答不会作为参与者数据保存。',
    ),
    step(
      'editor-save',
      '先保存草稿',
      '草稿可继续编辑，尚未成为可使用的问题版本。保存失败时应处理页面提示后重试。',
    ),
    step(
      'editor-publish',
      '准备好后发布版本',
      '点击此按钮才会真正保存并发布。已有会话仍保留其原版本；新工作台使用最新发布版本；已有工作台需明确切换问题版本。',
    ),
    step(
      'editor-back',
      '返回控制台继续',
      '发布完成后回到控制台，查看用户工作台和问题版本。离开前确认修改已保存。',
    ),
  ],
  'research-run': [
    step(
      'run-summary',
      '先检查当前进度',
      '这里显示本轮时间和会话状态。等待填写或审核时，先由参与者完成对应操作。',
    ),
    step(
      'participant-link',
      '把这个会话链接发给参与者',
      '参与者需要登录自己的账号。不要把研究者账号交给参与者。',
    ),
    step(
      'candidate-nodes',
      '查看和启停询问节点',
      'AI 决定节点时间，研究者只控制启用／停用。到达启用节点时服务器自动判断是否需要询问；回答后再评估后续节点。',
    ),
    step(
      'node-approval-policy',
      '更新后的节点需要重新启用',
      '新的候选节点默认关闭，不继承上一次生成的启用状态。这里显示当前候选数、已启用待触发数和最近 AI 更新时间。',
    ),
    step(
      'active-question-version',
      '核对当前使用的问题版本',
      '发布不会自动更新已有工作台。明确切换后，下一次模型调用使用新配置，旧候选节点清空，历史回答保留原题义。',
    ),
    step(
      'export-records',
      '导出本次过程',
      '这里导出 JSON 或 CSV，也能展开查看事件、调用结果和节点变化。',
    ),
  ],
  'participant-profile': [
    step(
      'run-summary',
      '了解本次场景',
      '先核对场景说明和当前时间，再填写下方的问题。',
    ),
    step(
      'answer-first',
      '按照你的实际情况填写',
      '逐项回答；带星号的问题需要填写。引导不会替你选择答案。',
    ),
    step(
      'answer-submit',
      '填写完成后提交',
      '点击这里保存回答。提交成功后会显示处理进度，再请你查看计划建议。',
    ),
  ],
  'participant-node': [
    step(
      'answer-first',
      '报告此刻的情况',
      '根据当前场景回答这些问题。填写时可以跳过或关闭引导，不会清空已经输入的内容。',
    ),
    step(
      'answer-submit',
      '提交这次回答',
      '检查后点击提交。保存成功后系统会处理新的信息，请等待后续安排。',
    ),
    step(
      'answer-open',
      '暂时收起后可重新打开',
      '如果你收起了问题，点击这里继续填写。',
    ),
  ],
  'participant-feedback': [
    step('answer-first', '填写本次反馈', '按照你对这次安排的实际感受回答。'),
    step(
      'answer-submit',
      '保存反馈',
      '点击提交后等待保存结果；如有错误提示，请处理后重试。',
    ),
  ],
  'participant-final': [
    step('answer-first', '完成最后的体验评价', '根据本次体验如实填写。'),
    step(
      'answer-submit',
      '提交并结束',
      '提交后看到“本次模拟已完成”，才表示评价和选择已保存。',
    ),
  ],
  'participant-review': [
    step(
      'run-calendar',
      '先查看日历中的建议',
      '这里展示待审核的安排。需要调整时，可以拖动或拉长建议中的任务块。',
    ),
    step(
      'review-panel',
      '检查安排和未安排工作',
      '阅读说明，检查有没有未安排的工作量；可以填写自己的原因或补充说明。',
    ),
    step(
      'review-accept',
      '决定是否保存',
      '愿意采用时点“接受并保存”；拖动调整后按钮变为“确认修改”。只有保存成功才会更新已确认计划。',
    ),
    step(
      'review-reject',
      '也可以不采用建议',
      '如果不适合你，可以填写原因并拒绝。拒绝会保留之前已经确认的计划。',
    ),
  ],
  'participant-active': [
    step(
      'run-calendar',
      '查看已确认的安排',
      '这里显示当前保存的日历。时间流逝不会自动记录任务完成。',
    ),
    step(
      'check-in',
      '情况改变时主动报告',
      '需要补充新的状态或情况时，点击这里填写。',
    ),
    step(
      'progress-panel',
      '报告任务进展',
      '只填写发生变化的任务剩余分钟数：完成填 0，不更新就留空。点击保存后系统会重新评估。',
    ),
  ],
  'participant-waiting': [
    step(
      'model-waiting',
      '正在处理你的信息',
      '请等待处理结果。刷新不会清除已经保存的回答，无需重复提交。',
    ),
  ],
  'participant-error': [
    step(
      'run-error',
      '这次处理没有成功',
      '先查看错误提示。已保存的回答仍在，已确认的计划也会保留；可联系研究者处理。',
    ),
    step(
      'generate',
      '问题解决后可以重试',
      '模型服务恢复后再点击重试。不需要为了重试而重新填写已保存的答案。',
    ),
  ],
  'participant-ready': [
    step(
      'run-summary',
      '查看当前进度',
      '请按照页面提示继续，或等待研究者的下一步安排。',
    ),
    step(
      'generate',
      '生成计划建议',
      '按钮可用时，点击这里请求建议；生成后需要你查看并确认。',
    ),
  ],
  'participant-completed': [
    step(
      'run-completed',
      '本次已经完成',
      '这里的完成提示表示回答与选择已保存，可以返回列表或退出。',
    ),
  ],
}

// Separate saved-profile editing and account setup from an assigned run's workflow.
tours['participant-edit-context'] = tours['participant-setup-context'].map(
  (s) =>
    s.target === 'setup-next'
      ? step(
          'setup-next',
          '继续修改工作节奏',
          '点击下一步保留本页输入并继续编辑；在工作节奏页点击保存后，两页修改才一起生效。',
        )
      : s,
)
tours['participant-account-tasks'] = [
  ...tours['participant-setup-tasks'].filter((s) => s.target !== 'setup-next'),
  step(
    'setup-initial-state',
    '填写此刻的状态',
    '按实际情况填写心情、精力、专注和压力，不确定的内容不要随意选择。',
  ),
  step(
    'setup-next',
    '保存首次设置',
    '任务、时间和当前状态一起保存。尚未开始会话也可以先保存；开始后再核对当时状态。',
  ),
]
for (const scope of [
  'participant-setup-rhythm',
  'participant-setup-availability',
  'participant-setup-tasks',
  'participant-account-tasks',
  'participant-setup-state',
]) {
  tours[scope] = [
    ...tours[scope],
    step(
      'setup-back',
      '需要时返回修改',
      '点击页面的上一步返回填写页面，当前页面未提交的输入会暂时保留；完成修改后按页面提示保存。刷新前请先保存。',
    ),
  ]
}
// These stages render inside the original workspace rather than the old run page.
tours['participant-workspace-waiting'] = [
  step(
    'run-summary',
    '正在生成建议',
    '已提交的信息已经保存。请等待结果，无需再次填写或提交。',
  ),
]
tours['participant-workspace-error'] = [
  step(
    'run-error',
    '查看处理结果',
    '读取或生成失败时，已保存的数据与已确认计划保留。请先阅读错误信息。',
  ),
  step(
    'refresh-workspace',
    '重新读取',
    '点击重新读取最新状态；生成失败且重试按钮可用时，再重试生成。',
  ),
  step(
    'generate',
    '重试生成',
    '模型服务恢复后可重试；按钮不可用时先处理当前填写或审核。',
  ),
]
tours['participant-workspace-completed'] = [
  step(
    'run-summary',
    '本次已经完成',
    '这里的完成提示表示回答与选择已保存，可以退出登录。',
  ),
]

tours['participant-account-saved'] = [
  step(
    'setup-saved',
    '首次设置已保存',
    '个人资料、任务、可用时间和填写时的状态已经保存。',
  ),
  step(
    'setup-edit',
    '仍可修改',
    '尚未开始会话时，可以返回核对和修改任务与时间。',
  ),
  step(
    'setup-enter',
    '进入工作台',
    '点击读取当前安排。尚未开始会话时，页面会提示等待。',
  ),
]
tours['participant-workspace'].splice(
  3,
  0,
  step(
    'daily-feedback',
    '填写每日反馈',
    '根据当天实际体验填写；提交成功后页面会显示已填写。',
  ),
)
for (const scope of [
  'participant-node',
  'participant-feedback',
  'participant-final',
  'participant-workspace-review',
  'participant-workspace-progress',
  'participant-workspace-personal-input',
  'participant-workspace-details',
]) {
  tours[scope] = [
    ...tours[scope],
    step(
      'close-panel',
      '收起当前面板',
      '关闭面板返回工作台。关闭不等于提交，完成填写后请点击对应的保存或提交按钮。',
    ),
  ]
}
