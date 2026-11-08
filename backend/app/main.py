import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, get_db
from app.routes import (
    analytics,
    auth,
    datasets,
    model_info,
    predictions,
    reports,
    settings,
    students,
    users,
)
from app.services.predictions import get_pipeline, sync_model_versions
from ml.predict import InvalidFeaturesError, ModelUnavailableError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("edupredict")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        pipeline = get_pipeline()
        with SessionLocal() as db:
            sync_model_versions(db, pipeline)
        logger.info("Loaded model version %s", pipeline.version)
    except ModelUnavailableError as exc:
        logger.warning("Predictions unavailable: %s", exc)
    except SQLAlchemyError as exc:
        logger.warning("Could not register model versions at startup: %s", exc)
    yield


app = FastAPI(
    title="EduPredict API",
    version="1.0.0",
    description=(
        "Student performance analytics and decision support. Predictions estimate whether a "
        "final course grade will fall below the pass mark. They do not predict dropout, and they "
        "are not definitive judgments about students."
    ),
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,  # auth uses a bearer header, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    """Logs method, path, status and timing. Never query strings or bodies, which may hold PII."""
    request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    response = await call_next(request)
    logger.info("%s %s %s %s %.1fms", request_id, request.method, request.url.path,
                response.status_code, (time.perf_counter() - started) * 1000)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/") and not request.url.path.startswith(
        ("/api/docs", "/api/redoc", "/api/openapi")
    ):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(InvalidFeaturesError)
async def invalid_features(_: Request, exc: InvalidFeaturesError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status.HTTP_422_UNPROCESSABLE_CONTENT)


@app.exception_handler(ModelUnavailableError)
async def model_unavailable(_: Request, exc: ModelUnavailableError) -> JSONResponse:
    logger.error("Model unavailable: %s", exc)
    return JSONResponse({"detail": "The prediction model is not available right now."},
                        status.HTTP_503_SERVICE_UNAVAILABLE)


@app.exception_handler(IntegrityError)
async def integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
    logger.warning("Integrity error: %s", type(exc.orig).__name__)
    return JSONResponse({"detail": "This conflicts with existing data."},
                        status.HTTP_409_CONFLICT)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", exc_info=exc)
    return JSONResponse({"detail": "Something went wrong on our side."},
                        status.HTTP_500_INTERNAL_SERVER_ERROR)


api = APIRouter(prefix="/api")
for module in (auth, users, students, predictions, analytics, model_info, reports, datasets,
               settings):
    api.include_router(module.router)


@api.get("/health", tags=["System"])
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database unavailable.") from exc
    try:
        model_version = get_pipeline().version
    except ModelUnavailableError:
        model_version = None
    return {"status": "ok", "database": "connected", "model_version": model_version}


app.include_router(api)
