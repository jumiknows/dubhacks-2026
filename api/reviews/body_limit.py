"""Bound review uploads before JSON parsing, including direct FastAPI requests."""

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class ReviewBodyLimitMiddleware:
    def __init__(self, app, max_bytes: int = 1_048_576):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/reviews/"):
            return await self.app(scope, receive, send)
        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                try:
                    length = int(value)
                except ValueError:
                    length = 0
                if length > self.max_bytes:
                    response = JSONResponse({"detail": "Review request exceeds the 1 MiB limit."}, status_code=413)
                    return await response(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(413, "Review request exceeds the 1 MiB limit.")
            return message

        return await self.app(scope, bounded_receive, send)
