"""Legacy retrieval query and explanation text; no scheduling mutations."""


def build_schedule_query(tasks: list[dict], state: dict) -> str:
    task_text = "; ".join(f"{t.get('title')} {t.get('type')} {t.get('status')}" for t in tasks[:6])
    return (
        f"Schedule tasks under focus {state.get('focus')} energy {state.get('energy')} "
        f"stress {state.get('stress')}. Tasks: {task_text}"
    )

def schedule_explanation(state: dict, memories: list[dict]) -> str:
    energy = int(state.get("energy", 4))
    stress = int(state.get("stress", 4))
    base = ""
    if energy <= 3:
        base += "Your current energy is low, so begin with a smaller action instead of a long high-intensity session."
    elif stress >= 6:
        base += "Your current stress is high, so HumanOS will propose changes and wait for confirmation before applying them."
    else:
        base += "Your current state can support a focused study session."
    if memories:
        base += f" The recommendation also uses {len(memories)} relevant prior episode(s)."
    return base
