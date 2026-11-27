'use client'
import type {
  Configuration,
  Question,
} from '@/lib/contracts/simulation-contracts'
import { Button, Field, freshQuestion, inputClass, Panel } from './common'

const originalProfileIds = new Set([
  'role',
  'learning_mode',
  'planning_failure_reasons',
  'recent_plan_failure',
  'task_switching_preference',
  'task_distribution_preference',
  'preferred_session_minutes',
  'rest_between_tasks_minutes',
  'typical_energy_morning',
  'typical_energy_afternoon',
  'typical_energy_evening',
])

const phases = {
  profile: 'Profile',
  initial_state: '初始状态',
  node: '节点询问',
  feedback: '计划反馈',
  daily_feedback: '每日反馈',
  final: '结束评价',
}
export function QuestionEditor({
  value,
  onChange,
  profileOnly = false,
}: {
  value: Configuration
  profileOnly?: boolean
  onChange: (v: Configuration) => void
}) {
  const update = (index: number, patch: Partial<Question>) =>
    onChange({
      ...value,
      questions: value.questions.map((q, i) =>
        i === index ? { ...q, ...patch } : q,
      ),
    })
  return (
    <div className="space-y-4">
      <Field tourId="config-name" label="问题方案名称">
        <input
          className={inputClass}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </Field>
      {value.questions.map((q, i) => (
        <Panel key={q.question_id} title={`${i + 1}. ${q.title || '新问题'}`}>
          <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>
              {q.question_id} · 题目修订 {q.revision}
            </span>
            <button
              type="button"
              disabled={!i}
              onClick={() => {
                const qs = [...value.questions]
                ;[qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]
                onChange({ ...value, questions: qs })
              }}
            >
              ↑ 上移
            </button>
            <button
              type="button"
              disabled={profileOnly && originalProfileIds.has(q.question_id)}
              title={
                profileOnly && originalProfileIds.has(q.question_id)
                  ? '原字段请保留；可以取消启用'
                  : undefined
              }
              onClick={() =>
                onChange({
                  ...value,
                  questions: value.questions.filter((_, n) => n !== i),
                })
              }
            >
              删除问题
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field tourId={i === 0 ? 'question-title' : undefined} label="题目">
              <input
                className={inputClass}
                value={q.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            </Field>
            <Field label="说明">
              <input
                className={inputClass}
                value={q.help}
                onChange={(e) => update(i, { help: e.target.value })}
              />
            </Field>
            <Field
              tourId={i === 0 ? 'question-phase' : undefined}
              label="展示阶段"
            >
              <select
                className={inputClass}
                disabled={profileOnly}
                value={q.phase}
                onChange={(e) =>
                  update(i, { phase: e.target.value as Question['phase'] })
                }
              >
                {Object.entries(phases)
                  .filter(([k]) =>
                    profileOnly
                      ? k === 'profile'
                      : k !== 'profile' || q.phase === 'profile',
                  )
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              tourId={i === 0 ? 'question-type' : undefined}
              label="回答方式"
            >
              <select
                className={inputClass}
                value={q.type}
                onChange={(e) =>
                  update(i, { type: e.target.value as Question['type'] })
                }
              >
                {Object.entries({
                  text: '文字',
                  single: '单选',
                  multiple: '多选',
                  number: '数字',
                  scale: '带锚点量表',
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              tourId={i === 0 ? 'question-usage' : undefined}
              label="答案用途"
            >
              <select
                className={inputClass}
                value={q.model_usage}
                onChange={(e) =>
                  update(i, {
                    model_usage: e.target.value as Question['model_usage'],
                  })
                }
              >
                <option value="both">排程与询问判断</option>
                <option value="planning">仅用于排程</option>
                <option value="node_decision">仅用于询问判断</option>
                <option value="evaluation_only">
                  仅研究评价，不提供给模型
                </option>
              </select>
            </Field>
            <Field label="字段含义（自定义题可不绑定）">
              <select
                className={inputClass}
                value={q.semantic_binding}
                onChange={(e) =>
                  update(i, {
                    semantic_binding: e.target
                      .value as Question['semantic_binding'],
                  })
                }
              >
                <option value="">补充背景，不绑定</option>
                {Object.entries({
                  energy: '精力（1–7）',
                  focus: '专注（1–7）',
                  stress: '压力（1–7）',
                  mood: '心情（单选）',
                  session_minutes: '工作段上限（分钟）',
                  rest_minutes: '休息下限（分钟）',
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            {(q.type === 'single' || q.type === 'multiple') && (
              <Field label="选项（每行一个）">
                <textarea
                  className={inputClass}
                  value={q.options.join('\n')}
                  onChange={(e) =>
                    update(i, {
                      options: e.target.value.split('\n'),
                      option_values: q.option_values?.length
                        ? e.target.value
                            .split('\n')
                            .map(
                              (_, n) => q.option_values?.[n] || 'option_' + n,
                            )
                        : [],
                    })
                  }
                />
              </Field>
            )}
            {(q.type === 'number' || q.type === 'scale') && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(['minimum', 'maximum', 'step'] as const).map((key, j) => (
                    <Field key={key} label={['最小值', '最大值', '步长'][j]}>
                      <input
                        className={inputClass}
                        type="number"
                        step="any"
                        value={q[key]}
                        onChange={(e) =>
                          update(i, { [key]: Number(e.target.value) })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="最低端文字">
                    <input
                      className={inputClass}
                      value={q.low_label}
                      onChange={(e) => update(i, { low_label: e.target.value })}
                    />
                  </Field>
                  <Field label="最高端文字">
                    <input
                      className={inputClass}
                      value={q.high_label}
                      onChange={(e) =>
                        update(i, { high_label: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </>
            )}
            <Field label="条件展示：同阶段前面的题">
              <select
                className={inputClass}
                value={q.display_if?.question_id || ''}
                onChange={(e) =>
                  update(i, {
                    display_if: e.target.value
                      ? { question_id: e.target.value, equals: '' }
                      : null,
                  })
                }
              >
                <option value="">始终展示</option>
                {value.questions
                  .slice(0, i)
                  .filter((p) => p.phase === q.phase && p.enabled)
                  .map((p) => (
                    <option key={p.question_id} value={p.question_id}>
                      {p.title || p.question_id}
                    </option>
                  ))}
              </select>
            </Field>
            {q.display_if &&
              (() => {
                const parent = value.questions.find(
                  (p) => p.question_id === q.display_if?.question_id,
                )
                const change = (raw: string) =>
                  update(i, {
                    display_if: {
                      question_id: q.display_if!.question_id,
                      equals:
                        parent && ['number', 'scale'].includes(parent.type)
                          ? Number(raw)
                          : raw,
                    },
                  })
                return (
                  <Field label="当答案等于">
                    {parent?.type === 'single' ? (
                      <select
                        className={inputClass}
                        value={String(q.display_if.equals)}
                        onChange={(e) => change(e.target.value)}
                      >
                        <option value="">请选择条件答案</option>
                        {parent.options.map((label, n) => (
                          <option
                            key={n}
                            value={parent.option_values?.[n] || label}
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={inputClass}
                        value={String(q.display_if.equals)}
                        onChange={(e) => change(e.target.value)}
                      />
                    )}
                  </Field>
                )
              })()}
          </div>
          <div className="mt-4 flex gap-6 text-sm">
            <label>
              <input
                type="checkbox"
                checked={q.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />{' '}
              必填
            </label>
            <label>
              <input
                type="checkbox"
                checked={q.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
              />{' '}
              启用
            </label>
          </div>
        </Panel>
      ))}
      <Button
        tourId="question-add"
        secondary
        onClick={() =>
          onChange({
            ...value,
            questions: [
              ...value.questions,
              {
                ...freshQuestion(),
                ...(profileOnly ? { phase: 'profile' as const } : {}),
              },
            ],
          })
        }
      >
        ＋ 添加问题
      </Button>
    </div>
  )
}
