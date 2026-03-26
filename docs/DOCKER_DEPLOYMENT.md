# Multi-Instance Docker Deployment

This application can be deployed using Docker Compose to host multiple isolated instances on the same server, all routed through a single Caddy reverse proxy.

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
     - name: esw
       image: plannertool:v2.0.0
       volume_type: volume
       volume_source: custom-esw-data
       
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

3. To start the services, either run the script with the `--start` flag, or do it manually:
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

The `scripts/deploy.py` script automatically generates a dynamic `Caddyfile`, `docker-compose.yml`, and `index.html` inside a `deployment/` directory based on your configured instances.
When run with the `--start` flag, it will also execute `docker compose up -d --remove-orphans` from within that directory. This command will start any new or updated services and cleanly decommission any containers that have been removed from `instances.yml`.

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