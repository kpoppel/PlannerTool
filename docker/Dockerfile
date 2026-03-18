# Multi-stage Dockerfile for PlannerTool
# - First stage builds frontend assets using Node (rollup / vite)
# - Final stage installs Python dependencies and runs the FastAPI/uvicorn app
#
# Mount an external `data` directory into the container at `/app/data`
# so that application state survives container upgrades.

######### Builder: frontend #########
FROM node:18-bullseye-slim AS nodebuilder
WORKDIR /build

# Copy package files and install node deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy frontend source that build relies on
COPY www ./www
COPY src ./src
COPY rollup.config.mjs vite.config.js ./

# Build vendor bundle and production frontend
RUN npm run build:vendor || true
RUN npm run build || true

######### Final: python runtime #########
FROM python:3.13-slim
LABEL maintainer="PlannerTool <noreply@example.com>"

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Install system packages required for some Python packages (cryptography, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     build-essential \
     libssl-dev \
     libffi-dev \
     ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy Python requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY ./*.py ./
COPY docs ./docs
COPY planner.py planner-dev.py ./
# Copy the internal Python package so imports like `planner_lib` are available
COPY planner_lib ./planner_lib

# Copy built frontend assets from nodebuilder
COPY --from=nodebuilder /build/www ./www

# Create a non-root user to run the app
RUN useradd -m -d /home/planner -s /bin/bash planner \
  && chown -R planner:planner /app

# Expose port used by uvicorn
EXPOSE 8000

# Make data directory a mount point so users can bind their external volume
VOLUME ["/app/data"]

# Run as non-root user
USER planner

# Default command: run uvicorn with the factory callable in planner:make_app
CMD ["uvicorn", "planner:make_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
