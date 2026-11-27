"""Explicit capabilities for conversation context and language evidence."""
from collections.abc import Callable
from dataclasses import dataclass
from .behavior_features import local_behavior_features
from ..domain.intent import classify_intent
from ..domain.ai_output_models import BehaviorFeatureOutput


@dataclass(frozen=True)
class BehaviorFeaturePorts:
    typed_completion: Callable
    messages: Callable
    prompt_version: str
    log_event: Callable


def extract_behavior_features(user_id: str, text: str, chat_context: dict | None = None, local_only: bool = False, *, ports: BehaviorFeaturePorts) -> dict:
    clean = text.strip()
    llm_result = None if local_only else ports.typed_completion(
        ports.messages(clean, chat_context),
        BehaviorFeatureOutput,
        "behavior_features",
    )
    extraction_provenance = "ai_model"
    if not isinstance(llm_result, dict):
        llm_result = local_behavior_features(clean)
        extraction_provenance = "local_rules"
    explicit_state = llm_result.get("explicit_state") if isinstance(llm_result.get("explicit_state"), dict) else {}
    llm_result["explicit_state"] = explicit_state
    intent_decision = classify_intent(clean, str(llm_result.get("intent") or "other"))
    llm_result["intent"] = intent_decision.intent
    llm_result["intent_decision"] = intent_decision.to_dict()
    llm_result["extraction_provenance"] = extraction_provenance
    llm_result["prompt_version"] = ports.prompt_version
    ports.log_event(user_id, "behavior_language_features", {"text": clean, "features": llm_result})
    return llm_result
