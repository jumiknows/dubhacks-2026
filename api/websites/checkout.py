"""Bind configured external destinations to existing signed, mock checkout carts."""

from api.schemas import PolicyCheck
from api.websites.service import safety_service


def destination_map(merchant_ids) -> dict[str, str]:
    service = safety_service()
    return {mid: config.checkout_url for mid in sorted(set(merchant_ids))
            if (config := service.registrations.get(mid)) and config.checkout_url}


def destination_check(merchant_id: str) -> PolicyCheck:
    service = safety_service()
    # Existing checkout only creates pi_mock_* intents, with no external URL.
    # Preserve that demo behavior without turning it into website verification.
    if merchant_id not in service.registrations:
        return PolicyCheck(rule="external_destination", passed=True,
            reason="Mock-only catalog checkout has no registered external destination. No merchant website was contacted or certified.")
    url, result = service.checkout_snapshot(merchant_id)
    if not url or result is None:
        return PolicyCheck(rule="external_destination", passed=False,
            reason="External checkout destination has no fresh server-side assessment. Run the merchant checkout check first.")
    return PolicyCheck(rule="external_destination", passed=result.allowed,
        reason=f"Registered checkout destination: {result.origin}. {result.summary}")
