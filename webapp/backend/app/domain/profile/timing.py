"""User-owned scheduling timing values shared by persistence and allocation."""

def timing_minutes(preferences, key, default, minimum, maximum):
    value = preferences.get(key, default)
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f'{key} must be whole minutes between {minimum} and {maximum}')
    return value


def rest_minutes(preferences):
    return timing_minutes(preferences, 'rest_between_tasks_minutes', 15, 0, 180)


def grid_minutes(preferences):
    value = timing_minutes(preferences, 'calendar_grid_minutes', 15, 1, 30)
    if value not in (1, 5, 10, 15, 30):
        raise ValueError('calendar_grid_minutes must be 1, 5, 10, 15 or 30')
    return value
