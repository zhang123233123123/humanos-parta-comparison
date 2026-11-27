"""QA-only scenario selection and ordered restore/clock coordination."""


def scenario_manifest(*, enabled, read_manifest, directory, database_path):
    if not enabled:
        raise RuntimeError("QA scenarios are disabled")
    return read_manifest(directory, database_path)


def restore_scenario(scenario_id, *, manifest, directory, database_path,
                     restore_database, update_clock):
    data = manifest()
    scenario = next(
        (item for item in data.get("scenarios", []) if item.get("id") == scenario_id), None)
    if not scenario:
        raise KeyError(scenario_id)
    snapshot_path = (directory / str(scenario["database"])).resolve()
    if snapshot_path.parent != directory.resolve() or not snapshot_path.exists():
        raise FileNotFoundError(f"Missing QA snapshot: {scenario_id}")
    restore_database(snapshot_path, database_path)
    state = update_clock(
        {"set_time": scenario["simulated_time"], "time_scale": 0}, allow_backward=True)
    return {"scenario": scenario, "clock": state, "qa_user": data.get("qa_user") or {}}
