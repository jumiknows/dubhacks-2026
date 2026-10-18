"""Intent and cart mandates, verified with the user's browser-generated ECDSA P-256 key.

WebCrypto produces raw r||s signatures (64 bytes); `cryptography` wants DER, so we convert.
Signatures are always checked over the exact string that was signed, never a re-serialization.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from pydantic import ValidationError

from api.schemas import IntentMandate


class MandateError(ValueError):
    pass


def _b64decode(s: str) -> bytes:
    s = s.strip()
    padded = s + "=" * (-len(s) % 4)
    try:
        if "-" in s or "_" in s:
            return base64.urlsafe_b64decode(padded)
        return base64.b64decode(padded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise MandateError("Signature is not valid base64.") from exc


def _b64url_int(s: str) -> int:
    return int.from_bytes(_b64decode(s), "big")


def public_key_from_jwk(jwk: dict[str, str]) -> ec.EllipticCurvePublicKey:
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256" or "x" not in jwk or "y" not in jwk:
        raise MandateError("Public key must be an EC P-256 JWK.")
    try:
        return ec.EllipticCurvePublicNumbers(_b64url_int(jwk["x"]), _b64url_int(jwk["y"]), ec.SECP256R1()).public_key()
    except ValueError as exc:
        raise MandateError("Public key is not a valid P-256 point.") from exc


def raw_to_der(raw: bytes) -> bytes:
    if len(raw) != 64:
        raise MandateError("Expected a 64-byte raw r||s ECDSA signature.")
    return encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))


def verify_signature(jwk: dict[str, str], message: str, signature_b64: str) -> bool:
    key = public_key_from_jwk(jwk)
    try:
        key.verify(raw_to_der(_b64decode(signature_b64)), message.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def sign_raw(private_key: ec.EllipticCurvePrivateKey, message: str) -> str:
    """Sign like WebCrypto does (raw r||s, base64). Used by tests and DEMO_SERVER_SIGNING."""
    r, s = decode_dss_signature(private_key.sign(message.encode("utf-8"), ec.ECDSA(hashes.SHA256())))
    return base64.b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")).decode()


def jwk_from_public_key(key: ec.EllipticCurvePublicKey) -> dict[str, str]:
    n = key.public_numbers()

    def enc(i: int) -> str:
        return base64.urlsafe_b64encode(i.to_bytes(32, "big")).rstrip(b"=").decode()

    return {"kty": "EC", "crv": "P-256", "x": enc(n.x), "y": enc(n.y)}


def mandate_id(payload: str) -> str:
    return "md_" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def parse_intent(jwk: dict[str, str], payload: str, signature: str, session_id: str) -> IntentMandate:
    """Verify the signature over the exact payload string, then parse and validate it."""
    if not verify_signature(jwk, payload, signature):
        raise MandateError("Intent mandate signature does not verify.")
    try:
        mandate = IntentMandate.model_validate(json.loads(payload))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise MandateError(f"Intent mandate payload is invalid: {exc}") from exc
    if mandate.session_id != session_id:
        raise MandateError("Intent mandate is for a different session.")
    return mandate
