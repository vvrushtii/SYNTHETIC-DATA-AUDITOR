"""Deploy the backend API on Modal (https://modal.com).

    modal deploy modal_app.py
    (optional: ALLOWED_ORIGINS=https://your-site.vercel.app modal deploy modal_app.py)

It runs the same FastAPI app (app.py) and worker (worker.py) as the Docker image, with the same library
versions, inside one Modal container. Jobs run in that container's temporary folder, which is deleted
when each job ends, exactly as in the Docker version. Saved past audits (metrics and column summaries, never
data rows) are kept on the Modal volume "sda-records".

The container starts when a request arrives and stops after SCALEDOWN seconds (5 minutes) without requests. The
dashboard checks the job every few seconds while it is open, which keeps the container running; if the
page is closed during a job, the job may be stopped when the container shuts down.
"""
import os
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent


def local(name):
    """The file next to this one (flat bundle) or in ../pipeline (repository layout)."""
    for p in (HERE / name, HERE.parent / "pipeline" / name):
        if p.exists():
            return str(p)
    # Not found: this file is also imported inside the running container, where the image is already built
    # and these paths are not read. (A file that is missing on your computer fails the deploy with a clear error.)
    return str(HERE / name)


SCALEDOWN = 300            # seconds without requests before the container stops (Modal allows up to 3600)
ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*")

image = (
    modal.Image.debian_slim(python_version="3.13")
    .pip_install("torch==2.15.0", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install_from_requirements(local("requirements.txt"))
    .run_commands("pip install --no-cache-dir --no-deps anonymeter==1.1.0")
    .env({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1",
          "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
          "NUMBA_CACHE_DIR": "/tmp/numba", "MPLCONFIGDIR": "/tmp/mpl", "JOBS_DIR": "/tmp/sda-jobs",
          "ALLOWED_ORIGINS": ORIGINS, "RECORDS_DIR": "/data/records"})
    .add_local_file(local("sda_pipeline.py"), "/root/sda_pipeline.py")
    .add_local_file(local("worker.py"), "/root/worker.py")
    .add_local_file(local("app.py"), "/root/app.py")
)

app = modal.App("sda-api", image=image)
records = modal.Volume.from_name("sda-records", create_if_missing=True)   # saved past audits (no data rows)


@app.function(cpu=2.0, memory=8192, timeout=3600, max_containers=1, scaledown_window=SCALEDOWN,
              volumes={"/data": records})
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def web():
    # One container only: the job list lives in its memory, and the API runs one job at a time.
    import sys
    sys.path.insert(0, "/root")
    import app as api
    api.ON_RECORDS_CHANGED = records.commit   # make each saved/deleted record durable at once
    return api.app
