# Synthetic Data Auditor - backend API image.
# Build from the repository root:   docker build -f backend/Dockerfile -t sda-api .
# Hugging Face Spaces: this same file is the Space's Dockerfile (the Space keeps the repository layout).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 \
    HOME=/tmp NUMBA_CACHE_DIR=/tmp/numba MPLCONFIGDIR=/tmp/mpl JOBS_DIR=/tmp/sda-jobs
WORKDIR /app

RUN pip install --no-cache-dir torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir --no-deps anonymeter==1.1.0

COPY pipeline/sda_pipeline.py backend/app.py backend/worker.py ./

RUN useradd -m -u 1000 user
USER user
EXPOSE 7860
HEALTHCHECK --interval=60s --timeout=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/health')"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log"]
