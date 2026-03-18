# Running PlannerTool in a container

You can run the applicatino in a docker container.  Build the container like this

    docker build -t plannertool -f docker/Dockerfile .

When built, create the container and mount the data directory to it so changes are persisted

    docker run -p 8000:8000 -v ./data:/app/data plannertool