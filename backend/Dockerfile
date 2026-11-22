# =============================================================================
#  Lead-to-Cash API (FastAPI)
#
#  - every Python package is pinned to an exact version AND its hash
#    (requirements.lock): a tampered or substituted package fails the build
#  - only the application code is copied (no tests, no .env, no local files)
#  - runs as an unprivileged, fixed numeric user; nothing is written to disk
#    (Kubernetes mounts the root file system read-only, see k8s/)
# =============================================================================
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, so this layer is reused until requirements.lock changes
COPY requirements.lock .
RUN pip install --require-hashes -r requirements.lock

COPY app ./app

# Fixed numeric id: "runAsNonRoot" in Kubernetes can only be verified for a numeric user
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001:10001

EXPOSE 8000

# No curl in the image: the probe uses the Python that is already there
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)"]

# --no-access-log     : the application writes its own access log with tokens removed from addresses
# --no-server-header  : do not advertise the server software
# --no-proxy-headers  : the application itself decides how many proxies to trust (FORWARDED_ALLOW_HOPS)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--no-server-header", "--no-proxy-headers"]
