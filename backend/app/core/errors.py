import logging

from beanie.exceptions import RevisionIdWasChanged
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.request_context import get_request_id

logger = logging.getLogger("app.errors")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "request_id": get_request_id()},
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        # Never echo submitted values back (they may contain passwords or tokens)
        errors = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path"))
            msg = str(err.get("msg", "Invalid value")).replace("Value error, ", "")
            errors.append({"loc": err.get("loc"), "msg": f"{loc}: {msg}" if loc else msg, "type": err.get("type")})
        summary = "; ".join(e["msg"] for e in errors[:5])
        return JSONResponse(
            status_code=422,
            content={"detail": summary or "Invalid request", "errors": errors, "request_id": get_request_id()},
        )

    @app.exception_handler(RevisionIdWasChanged)
    async def concurrent_update_handler(request: Request, exc: RevisionIdWasChanged):
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "This record was changed by someone else at the same time. Please refresh and try again.",
                     "request_id": get_request_id()},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s %s (request_id=%s)", request.method, request.url.path, get_request_id())
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal error occurred. Please contact support with the request id.", "request_id": get_request_id()},
        )
