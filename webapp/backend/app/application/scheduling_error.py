"""Public scheduling failure codes; raw model output is never part of the response."""
class SchedulingError(ValueError):
    def __init__(self, code, message, violations=()):
        super().__init__(message)
        self.code = code
        self.violations = [{'type': v['type']} for v in violations
                           if isinstance(v, dict) and isinstance(v.get('type'), str)]

    def payload(self):
        return {'error': 'scheduling_error', 'code': self.code,
                'message': str(self), 'violations': self.violations}
