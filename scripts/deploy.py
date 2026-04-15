#!/usr/bin/env python3
import os
import sys
import subprocess
import argparse

try:
    import yaml
except ImportError:
    print("Error: The 'pyyaml' package is required.")
    print("Please install it in your environment: pip install pyyaml")
    sys.exit(1)

def get_version():
    try:
        with open('VERSION', 'r') as f:
            return f.read().strip()
    except FileNotFoundError:
        return "latest"

def generate_index_html(instances):
    html = [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        "  <title>PlannerTool Instances</title>",
        "  <style>",
        "    body { font-family: system-ui, -apple-system, sans-serif; background-color: #f4f4f9; color: #333; margin: 0; padding: 2rem; display: flex; flex-direction: column; align-items: center; }",
        "    h1 { color: #2c3e50; margin-bottom: 2rem; }",
        "    ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 400px; }",
        "    li { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: transform 0.2s, box-shadow 0.2s; }",
        "    li:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.15); }",
        "    a { display: block; padding: 1rem 1.5rem; text-decoration: none; color: #3498db; font-weight: bold; font-size: 1.2rem; text-align: center; border-radius: 8px; }",
        "    a:hover { background-color: #f8fbfe; color: #2980b9; }",
        "  </style>",
        "</head>",
        "<body>",
        "<h1>Available PlannerTool Instances</h1>",
        "<ul>"
    ]
    for inst in instances:
        name = inst['name']
        html.append(f'  <li><a href="/{name}/">{name}</a></li>')
    html.extend(["</ul>", "</body>", "</html>"])
    return "\n".join(html)

def generate_caddyfile(instances):
    lines = [":80 {"]
    for inst in instances:
        name = inst['name']
        lines.extend([
            f"    redir /{name} /{name}/",
            f"    redir /{name}/admin /{name}/admin/",
            f"    handle_path /{name}/* {{",
            f"        reverse_proxy planner-{name}:8000",
            "    }"
        ])
    lines.extend([
        "    handle / {",
        "        root * /srv",
        "        file_server",
        "    }"
    ])
    lines.append("}")
    return "\n".join(lines)

def generate_docker_compose(instances, version):
    compose = {
        "services": {
            "caddy": {
                "image": "caddy:2-alpine",
                "ports": ["80:80"],
                "volumes": [
                    "./Caddyfile:/etc/caddy/Caddyfile",
                    "./index.html:/srv/index.html"
                ],
                "depends_on": [f"planner-{inst['name']}" for inst in instances]
            }
        },
        "volumes": {}
    }
    
    for inst in instances:
        name = inst['name']
        container_name = f"planner-{name}"
        
        vol_type = inst.get('volume_type', 'volume')
        if vol_type == 'bind':
            vol_source = inst.get('volume_source', f"./data/{name}")
            # Ensure host directory exists to prevent Docker creating it as root.
            # Resolve relative to 'deployment/' since docker-compose runs from there.
            target_dir = os.path.join('deployment', vol_source) if not os.path.isabs(vol_source) else vol_source
            os.makedirs(target_dir, exist_ok=True)
        else:
            vol_source = inst.get('volume_source', f"data-{name}")
        
        image = inst.get('image', f"plannertool:{version}")
        
        volumes = [f"{vol_source}:/app/data"]
        if 'external_database' in inst:
            volumes.append(f"{inst['external_database']}:/app/data/config/database.yaml:ro")
        
        compose["services"][container_name] = {
            "image": image,
            "environment": [
                f"ROOT_PATH=/{name}",
                "PLANNER_SECRET_KEY=${PLANNER_SECRET_KEY}"
            ],
            "volumes": volumes,
            "restart": "unless-stopped"
        }
        
      
        if vol_type == 'volume':
            compose["volumes"][vol_source] = {}
        
    return compose

def main():
    parser = argparse.ArgumentParser(
        description="Generate deployment files for PlannerTool instances and optionally start them.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        '--config',
        default='instances.yml',
        help="Path to the instances configuration file.\n(default: %(default)s)"
    )
    parser.add_argument(
        '--start',
        action='store_true',
        help="Start the docker containers after generating the files."
    )
    parser.add_argument(
        '-b', '--build-images',
        action='store_true',
        help="Build required Docker images after generating files (uses top-level VERSION)."
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help="Apply changes: write generated files to `deployment/`, optionally build images and start containers. Without this flag the script performs a dry-run and prints the planned files."
    )
    
    args = parser.parse_args()

    instances_file = args.config
    
    if not os.path.exists(instances_file):
        if instances_file == 'instances.yml': # Default file not found
            print(f"Error: Default configuration file '{instances_file}' not found.")
            print("Please create one (e.g., using instances.example.yml as a template) or specify the path using the --config <path> argument.")
        else: # User-specified file not found
            print(f"Error: Specified configuration file not found: {instances_file}")
        sys.exit(1)
    
    version = get_version()
    
    with open(instances_file, 'r') as f:
        config = yaml.safe_load(f) or {}
            
    instances = config.get('instances', [])
    if not instances:
        print(f"No instances found inside {instances_file}")
        sys.exit(1)
    
    # Generate file contents (always performed) then either print as a dry-run
    # or write them into `deployment/` when --apply is specified.
    caddy_contents = generate_caddyfile(instances)
    compose_obj = generate_docker_compose(instances, version)
    index_contents = generate_index_html(instances)

    if not args.apply:
        # Dry-run: print help and show generated files
        print()
        parser.print_help()
        print('\nDry-run (no files written). Generated outputs follow:')
        print('\n--- Caddyfile ---\n')
        print(caddy_contents)
        print('\n--- docker-compose.yml ---\n')
        print(yaml.dump(compose_obj, sort_keys=False))
        print('\n--- index.html ---\n')
        print(index_contents)
        print('\nTo write files, build images and start the stack run with --apply. Example:')
        print('  python scripts/deploy.py --apply --start')
        sys.exit(0)

    # Apply: write files into deployment/ and optionally build/start
    os.makedirs('deployment', exist_ok=True)

    with open('deployment/Caddyfile', 'w') as f:
        f.write(caddy_contents)

    with open('deployment/docker-compose.yml', 'w') as f:
        yaml.dump(compose_obj, f, sort_keys=False)

    with open('deployment/index.html', 'w') as f:
        f.write(index_contents)

    print(f"Generated Caddyfile, docker-compose.yml, and index.html in the 'deployment/' directory for {len(instances)} instance(s).")

    build_images = args.build_images or args.start
    if build_images:
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        build_script = os.path.join(root_dir, 'scripts', 'build-image.sh')
        if not os.path.exists(build_script):
            print(f"WARNING: build script not found at {build_script}; skipping image build.")
        else:
            print("Building requested images using scripts/build-image.sh...")
            try:
                subprocess.run([build_script], check=True)
            except subprocess.CalledProcessError as e:
                print(f"ERROR: build script failed with code {e.returncode}")
                sys.exit(e.returncode)

    if args.start:
        print("Deploying instances...")
        try:
            subprocess.run(["docker", "compose", "up", "-d", "--remove-orphans"], cwd="deployment", check=True)
            print("\nDeployment successful!")

            print("\nCleaning up dangling Docker images...")
            # The -f flag forces the prune without a confirmation prompt
            subprocess.run(["docker", "image", "prune", "-f"], check=True)
            print("Cleanup complete.")
        except subprocess.CalledProcessError as e:
            print(f"\nDeployment failed with error code {e.returncode}")
            sys.exit(e.returncode)
    else:
        print("\nConfiguration files generated. To start the stack, run the following command:")
        print("  cd deployment && docker compose up -d")

if __name__ == '__main__':
    main()