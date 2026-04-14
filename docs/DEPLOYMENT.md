# Proxmox/Virtualised Linux Deployment

On your favorite virtualiser or bare metal machine, install ltest Debian 13.x as the base.

If you want to run using LXC on Proxmox, install Proxmox 9.x . Debian 13 is not supported on Proxmox 8.x.
Use a Debian 13 base template. Setup the LXC, give it reasonable settings (2 CPU, 512 MB RAM, 8 GB disk, Static or DHCP IP)

Login and update the container `apt update; apt upgrade; apt install nginx git python3-venv`. If you intend to use docker, add
`docker.io docker-compose`

Add a non-root user to run the service `adduser planner`. Set a password, then `su planner` and go to the user home directory.

Since you are reading this you have probably followed the README.md instructions for getting started already. If not, do these steps.

# Single-Instance Docker Deployment

This application can be deployed in multiple ways:
- As a service running on a port, like port 8000
- Using nginx as proxy and using systemd to start the service
- As a docker container with or without a proxy.

## Running as a service without proxy

The application can be run from the command line directly

`uvicorn planner:make_app --port 8000 --factory --reload 2>&1 |tee logfile.log`

If you want to run the Vite build version:
```
npm run build
uvicorn planner:make_dist_app --port 8000 --factory --reload 2>&1 |tee logfile.log
```

## Running as a service with nginx proxy

Add the file `nano /etc/nginx/sites-enabled/plannertool`
```
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Remove the symlink for default site `unlink /etc/nginx/sites-enabled/default` and relad nginx `systemctl reload nginx`.

Proceed to set up the tool to automatically update and start.  This step uses `scripts/systemd_runner.sh` and `scripts/plannertool.service`. Ensure the shell script is `chmod +x`

As root copy the `plannertool.service` to `/etc/systemd/system/`. Then reload and start it:
```
systemctl daemon-reload
systemctl enable plannertool
systemctl start plannertool
```

To update, run `systemctl restart plannertool` as root.

## Running as a service in docker

First build he containerr and tag it with the version in `VERSION`:

```
./scripts/build-image.sh
```

Or manually:
```
docker build -f docker/Dockerfile -t plannertool:latest -t plannertool:v2.1.0 .`
docker image prune
```

Next run the container with the volumes mounted:

`docker run -d -p 8000 -v /app/data:/app/data -v <path-to-people-database>/database.yaml:/app/data/config/database.yaml --name plannertool plannertool`

Point the proxy to the container port if applying a proxy.

# Multi-Instance Docker Deployment

This application can also be deployed using Docker Compose to host multiple isolated instances on the same server, all routed through a single Caddy reverse proxy.

## Requirements
- Docker
- Docker Compose plugin
- Python 3 with `pyyaml`

## Setup

1. Define your instances in a configuration file. By default, the script looks for `instances.yml` in the project root. You can use `instances.example.yml` as a template.
   ```yaml
   instances:
     # Implicitly uses a Docker named volume (data-alpha)
     - name: alpha
     
     # Explicitly use a local bind mount
     - name: beta
       volume_type: bind
       volume_source: ./data/beta
       
     # Explicitly specify a custom Docker named volume and an exact image version
     - name: delta
       image: plannertool:v2.0.0
       volume_type: volume
       volume_source: custom-delta-data
       
     # Example with an external people database mapped into the container
     - name: gamma
       external_database: /opt/shared/company-people-db.yaml
   ```

2. Run the deployment script to generate the configuration files. Use the `--config` flag if your file has a different name or location.
   ```bash
   # Generate from default instances.yml
   python3 scripts/deploy.py

   # Generate from a custom config file
   python3 scripts/deploy.py --config path/to/my-instances.yml
   ```

3. **Set the encryption key**: Before starting the containers, you must set the `PLANNER_SECRET_KEY` environment variable. This key is used to encrypt Personal Access Tokens (PATs) at rest.

   ```bash
   # Generate a random encryption key (do this once and save it securely!)
   openssl rand -base64 32 > .encryption_key

   # Create the environment file for docker compose
   echo "PLANNER_SECRET_KEY="$(cat .encryption_key) > deployment/.env
   ```

   If running by docker container or development mode, set the environment variable
   ```
   export PLANNER_SECRET_KEY=$(cat .encryption_key)
   ```

   **Important**: 
   - Store the `.encryption_key` file securely and back it up
   - Never commit `.encryption_key` to version control
   - The same key must be used consistently or encrypted PATs cannot be decrypted
   - For production deployments, consider using Docker secrets or a secrets management service


4. To start the services, either run the script with the `--start` flag, or do it manually:
   ```bash
   # Option A: Let the script start everything
   python3 scripts/deploy.py --start

   # With a custom config file:
   python3 scripts/deploy.py --config path/to/my-instances.yml --start

   # Option B: Start manually
   cd deployment
   docker compose up -d
   ```

## How it works

The `scripts/deploy.py` script generates a dynamic `Caddyfile`, `docker-compose.yml`, and `index.html` for your configured instances.
By default the script performs a dry-run: it prints usage help and displays the generated files without writing anything to disk. To write the files into the `deployment/` directory and perform actions, pass `--apply`.

When `--apply` is used together with `-b/--build-images` or `--start`, the script will invoke `scripts/build-image.sh` to build `plannertool:<VERSION>` (and tag `plannertool:latest`) before starting the stack. To actually start containers the script will run `docker compose up -d --remove-orphans` from the `deployment/` directory only when `--apply` and `--start` are both provided.

### Versioning and Staged Rollouts
By default, instances use an image tagged with the version defined in the `VERSION` file (e.g., `plannertool:v2.1.0`). 
The script instructs Docker Compose to build the current codebase and automatically tag it with both `latest` and the current version.
To perform a staged rollout or pin an instance to a specific version, you can specify an explicit `image:` property for that instance in `instances.yml` (e.g., `image: plannertool:v2.0.0`). The script will then deploy that instance using the specified image without attempting to rebuild it.

### Image Cleanup
After a successful deployment, the script automatically runs `docker image prune` to remove any dangling images left over from the build process. This helps keep your system clean and saves disk space.

### Volume Management
By default, instances use isolated Docker named volumes (`data-<name>`). 
If you prefer to store data in a specific folder on your host machine, you can specify `volume_type: bind` and provide a `volume_source` path. The deployment script will automatically create the host directory to prevent Docker from creating it with root permissions.

### External People Database
If you are maintaining a central people database across instances or managed by an external tool, you can mount it directly into the container using the `external_database` property in your `instances.yml`. Provide the host path to the YAML file, and the deployment script will bind mount it as read-only to `/app/data/config/database.yaml` inside the container.

## Separating Source Code from Deployment

If you want to keep your application source code separate from your production server, you can decouple the build process from the deployment process:

1. **Build and Push:** Build the Docker image on a CI/CD server (or your local machine) and push it to a container registry (e.g., Docker Hub, GitHub Container Registry).
2. **Configure External Image:** In your `instances.yml`, set the `image` property to your fully qualified registry URL (e.g., `image: ghcr.io/myorg/plannertool:v2.1.0`).
3. **Generate Configuration:** Run `python3 scripts/deploy.py` locally. Because the script detects an external image name, it will intentionally omit the `build:` instructions from the generated `docker-compose.yml`.
4. **Deploy:** Copy the generated `deployment/` folder to your production server.
5. **Run:** On the production server, navigate to the `deployment/` folder and execute `docker compose up -d`. 

With this workflow, the production server only needs Docker installed. It does not require Python, the deployment script, or the application source code.