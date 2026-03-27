# Multi-stage Dockerfile for PlannerTool
# - First stage builds frontend assets using Node (rollup / vite)
# - Final stage installs Python dependencies and runs the FastAPI/uvicorn app
#
# Mount an external `data` directory into the container at `/app/data`
# so that application state survives container upgrades.

######### Builder: frontend #########
FROM node:20-bullseye-slim AS nodebuilder
WORKDIR /build

# Copy package files and install node deps
#COPY package.json package-lock.json ./
COPY package.json ./
RUN npm install --no-audit --no-fund
RUN npm ci --no-audit --no-fund

# Copy frontend source that build relies on
COPY www ./www
COPY src ./src
COPY rollup.config.mjs vite.config.js ./

# Build vendor bundle and production frontend
RUN npm run build:vendor || true
RUN npm run build || true

######### Builder: python deps #########
FROM python:3.13-slim AS pybuilder
WORKDIR /build

# Install system packages required for building Python packages (cryptography, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     build-essential \
     libssl-dev \
     libffi-dev \
  && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy Python requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

######### Final: python runtime #########
FROM python:3.13-slim
LABEL maintainer="PlannerTool <kpoppel at github.com>"

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Install runtime dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     gosu \
     ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Create a non-root user to run the app (home directory required by azure-devops cache)
RUN useradd -m -s /bin/bash planner

# Copy an entrypoint script that will fix permissions and run as the planner user
COPY docker/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

# Copy Python environment from pybuilder
COPY --from=pybuilder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application source
COPY ./*.py ./
COPY VERSION ./
COPY docs ./docs
COPY planner_lib ./planner_lib
COPY www-admin ./www-admin

# Set ownership of the app directory. The entrypoint will handle the volume mount.
RUN chown -R planner:planner /app

# Copy built frontend assets from nodebuilder
COPY --from=nodebuilder /build/www ./www
COPY --from=nodebuilder /build/dist ./dist

# Make data directory a mount point
VOLUME ["/app/data"]

ENV HOST=0.0.0.0
ENV PORT=8000
ENV DATA_DIR=/app/data
ENV ROOT_PATH=""

EXPOSE $PORT

ENTRYPOINT ["entrypoint.sh"]

# Run the production app using uvicorn factory via the entrypoint.
CMD ["sh", "-c", "uvicorn planner:make_dist_app --factory --host $HOST --port $PORT --root-path \"${ROOT_PATH}\""]
