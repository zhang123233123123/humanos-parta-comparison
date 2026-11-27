"""Required total workload for persisted tasks; drafts may remain incomplete."""


def require_task_duration(value: object) -> int:
    if type(value) is not int or not 1 <= value <= 1440:
        raise ValueError('请填写任务总工作量（1–1440 分钟的整数）。Task duration is required: enter an integer from 1 to 1440 minutes.')
    return value
