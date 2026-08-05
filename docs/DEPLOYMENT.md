# How to deploy the application for production or development

The application has two deployment methods:

1. **Vite dev server** (`run_dev.sh`) — the standard development workflow
2. **Docker** (single container, or Caddy-proxied multi-instance) — production

Whatever you do, using Docker is the most convenient for production.
The Vite dev server is the recommended way to run the app during development.

In any situaion you need to have a secret encryption key.

# Generate a 32 character secrey encryption key

To generate an encryption key run this command line:

   ```bash
   # Generate a random encryption key (do this once and save it securely!)
   openssl rand -base64 32 > .encryption_key

   # Alternatives:
   tr -dc A-Za-z0-9_ < /dev/urandom | head -c 32 > .encryption_key
   # or:
   python3 -c "import secrets; print(secrets.token_urlsafe(24))" > .encryption_key

   # Make it user accessible only
   chmod 600 .encryption_key
   ```

This key is used to encrypt Personal Access Tokens (PATs) at rest.

**Note:**
- Store the `.encryption_key` file securely and back it up
- Never commit `.encryption_key` to version control
- The same key must be used consistently or encrypted PATs cannot be decrypted

With the key stored in `.encryption_key`, select one of the deployment methods.

# Deploy using Docker

You can deploy using Docker as s single container in a manual way, or using the tools
to setup a Caddy + PlannerTool stack where multiple instances can run side-by-side.

## Building the image

Build he containerr and tag it with the version in `VERSION`:

```
./scripts/build-image.sh
```

Or manually:
```
docker build -f docker/Dockerfile -t plannertool:latest -t plannertool:$(cat VERSION) .
docker image prune
```

## Docker - manual single instance

Run the container with the volumes mounted:

`docker run -d -p 8000 -v <path-to-data>:/app/data -v <path-to-people-database>/database.yaml:/app/data/config/database.yaml --name plannertool plannertool`

Access at `http://localhost:8000`

## Docker - Caddy-proxied multi-instance (preferred)

The application can be deployed using Docker Compose to host multiple isolated instances on the same server, all routed through a single Caddy reverse proxy.

### Requirements
- Docker
- Docker Compose plugin
- Python 3 with `pyyaml`

### Setup instances

**Define your instances** in a configuration file. By default, the script looks for `instances.yml` in the project root. You can use `docker/instances.example.yml` as a template.

**Run the deployment script** to generate the configuration files. Use the `--config` flag if your file has a different name or location.

   ```bash
   # Generate from default instances.yml
   python3 scripts/deploy.py --apply

   # Generate from a custom config file
   python3 scripts/deploy.py --apply --config path/to/my-instances.yml
   ```

Run the tool without parameters to get more options.  `--apply` builds the files needed. See below for more desciption on the `deploy.py` tool.

The script creates a `deployment/` directory, creates a docker-compose file and Caddyfile, and an index.html file to serve as a landing page for the instances.

**Set the encryption key**: Before starting the containers, you must set the `PLANNER_SECRET_KEY` environment variable. 

   ```bash
   # Create the environment file for docker compose
   echo "PLANNER_SECRET_KEY="$(cat .encryption_key) > deployment/.env
   ```
**Note**: For production deployments, consider using Docker secrets or a secrets management service

To start the services, either run the script with the `--start` flag, or do it manually:
   ```bash
   # Option A: Let the script start everything
   python3 scripts/deploy.py --start

   # With a custom config file:
   python3 scripts/deploy.py --config path/to/my-instances.yml --start

   # Option B: Start manually
   cd deployment && docker compose up -d
   ```

### Information on the `deploy.py` tool

The `scripts/deploy.py` script generates a dynamic `Caddyfile`, `docker-compose.yml`, and `index.html` for your configured instances.
By default the script performs a dry-run: it prints usage help and displays the generated files without writing anything to disk. To write the files into the `deployment/` directory and perform actions, pass `--apply`.

When `--apply` is used together with `-b/--build-images` or `--start`, the script will invoke `scripts/build-image.sh` to build `plannertool:<VERSION>` (and tag `plannertool:latest`) before starting the stack. To actually start containers the script will run `docker compose up -d --remove-orphans` from the `deployment/` directory only when `--apply` and `--start` are both provided.

#### Versioning and Staged Rollouts
By default, instances use an image tagged with the version defined in the `VERSION` file (e.g., `plannertool:v2.1.0`). 
The script instructs Docker Compose to build the current codebase and automatically tag it with both `latest` and the current version.
To perform a staged rollout or pin an instance to a specific version, you can specify an explicit `image:` property for that instance in `instances.yml` (e.g., `image: plannertool:v2.0.0`). The script will then deploy that instance using the specified image without attempting to rebuild it.

#### Image Cleanup
After a successful deployment, the script automatically runs `docker image prune` to remove any dangling images left over from the build process. This helps keep your system clean and saves disk space.

#### Volume Management
By default, instances use isolated Docker named volumes (`data-<name>`). 
If you prefer to store data in a specific folder on your host machine, you can specify `volume_type: bind` and provide a `volume_source` path. The deployment script will automatically create the host directory to prevent Docker from creating it with root permissions.

#### External People Database
If you are maintaining a central people database across instances or managed by an external tool, you can mount it directly into the container using the `external_database` property in your `instances.yml`. Provide the host path to the YAML file, and the deployment script will bind mount it as read-only to `/app/data/config/database.yaml` inside the container.

### Separating Source Code from Deployment

If you want to keep your application source code separate from your production server, you can decouple the build process from the deployment process:

1. **Build and Push:** Build the Docker image on a CI/CD server (or your local machine) and push it to a container registry (e.g., Docker Hub, GitHub Container Registry).
2. **Configure External Image:** In your `instances.yml`, set the `image` property to your fully qualified registry URL (e.g., `image: ghcr.io/myorg/plannertool:v4.2.0`).
3. **Generate Configuration:** Run `python3 scripts/deploy.py` locally. Because the script detects an external image name, it will intentionally omit the `build:` instructions from the generated `docker-compose.yml`.
4. **Deploy:** Copy the generated `deployment/` folder to your production server.
5. **Run:** On the production server, navigate to the `deployment/` folder and execute `docker compose up -d`. 

With this workflow, the production server only needs Docker installed. It does not require Python, the deployment script, or the application source code.



   If running by docker container or development mode, set the environment variable
   ```
   # Create the environment file for docker compose
   echo "PLANNER_SECRET_KEY="$(cat .encryption_key) > deployment/.env

   export PLANNER_SECRET_KEY=$(cat .encryption_key)
   ```

   **Important**: 
   - Store the `.encryption_key` file securely and back it up
   - Never commit `.encryption_key` to version control
   - The same key must be used consistently or encrypted PATs cannot be decrypted
   - For production deployments, consider using Docker secrets or a secrets management service

# Deploy using Vite dev server (recommended for development)

The `run_dev.sh` script starts both the Vite dev server (port 5173) and the
uvicorn backend (port 8001) together:

   ```bash
   ./scripts/run_dev.sh
   ```

The Vite server proxies API calls to the backend and provides hot-module reload.

Use the application by browsing to `http://localhost:5173`

# Deploy using uvicorn alone

For backend-only work or quick local testing of the production build, build the
frontend first (uvicorn serves `dist/`):

```bash
# Only if the Lit bundle needs to be updated:
npm run build:vendor

# Build and run:
npm run build
PLANNER_SECRET_KEY=`cat .encryption_key`  uvicorn planner:make_app --port 8000 --factory --reload 2>&1 |tee logfile.log
```

Use the application by browsing to `http://localhost:8000`

# Proxmox/Virtualised Linux Deployment (just for completeness)

On your favorite virtualiser or bare metal machine, install ltest Debian 13.x as the base.

If you want to run using LXC on Proxmox, install Proxmox 9.x . Debian 13 is not supported on Proxmox 8.x.
Use a Debian 13 base template. Setup the LXC, give it reasonable settings (2 CPU, 512 MB RAM, 8 GB disk, Static or DHCP IP)

Login and update the container `apt update; apt upgrade; apt install nginx git python3-venv`. If you intend to use docker, add
`docker.io docker-compose`

Add a non-root user to run the service `adduser planner`. Set a password, then `su planner` and go to the user home directory.

Follow one of the deployment options above.
