"""Identity rules for feedback retries, independent of persistence and HTTP."""


def require_same_feedback_target(existing, payload):
    if str(existing['task_id']) != str(payload['task_id']):
        raise ValueError('该反馈请求编号已用于另一项任务，请重新提交。')
    previous_session = str(existing['execution_session_id'] or '')
    requested_session = str(payload.get('execution_session_id') or '')
    if previous_session != requested_session:
        raise ValueError('该反馈请求编号已用于另一条执行记录，请重新提交。')
