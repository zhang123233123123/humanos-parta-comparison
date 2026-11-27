"""Retirement boundary for natural-language task intake."""


class ManualTaskEntryRequired(ValueError):
    def __init__(self):
        super().__init__('任务解析与对话补充已下架，请通过任务表单明确填写字段。Task parsing is retired; submit structured task fields.')


def require_supported_background_intake(kind: str, payload: dict) -> None:
    if kind == 'chat_parse' and payload.get('assistant_mode') != 'calendar_advisor':
        raise ManualTaskEntryRequired()
