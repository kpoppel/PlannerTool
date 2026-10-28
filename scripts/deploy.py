#!/usr/bin/env python3
import os
import re
import sys
import subprocess
import argparse
import shlex
import socket
import ssl
import time
from pathlib import Path
from deploy_auth import add_auth_compose, load_auth_services, validate_instances

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

def validate_https_hostname(value):
    label = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    if len(value) > 253 or not re.fullmatch(rf"{label}(?:\.{label})*", value):
        raise argparse.ArgumentTypeError(
            "HTTPS hostname must be a DNS hostname without a scheme, port, or path."
        )
    return value.lower()

def load_https_tls(config, manifest_path, hostname):
    settings = config.get('https_tls', {'mode': 'acme'})
    if not isinstance(settings, dict) or settings.get('mode') not in ('acme', 'internal', 'provided'):
        raise ValueError('https_tls requires mode: acme|internal|provided')
    mode = settings['mode']
    allowed = {'mode', 'certificate_file', 'key_file', 'ca_file'} if mode == 'provided' else {'mode'}
    if set(settings) - allowed:
        raise ValueError('Unsupported https_tls setting for mode ' + mode)
    if 'https_tls' in config and hostname is None:
        raise ValueError('https_tls requires https_hostname')
    result = dict(settings)
    if mode == 'provided':
        if not {'certificate_file', 'key_file'} <= set(settings):
            raise ValueError('Provided TLS requires certificate_file and key_file')
        base = Path(manifest_path).resolve().parent
        for field in ('certificate_file', 'key_file', 'ca_file'):
            if field not in settings:
                continue
            if not isinstance(settings[field], str) or not settings[field]:
                raise ValueError('TLS file paths must be nonempty strings')
            path = (base / settings[field]).resolve()
            if not path.is_file():
                raise ValueError('Missing TLS file: ' + str(path))
            result[field] = str(path)
        if Path(result['key_file']).stat().st_mode & 0o077:
            raise ValueError('TLS private key requires mode 0600')
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(result['certificate_file'], result['key_file'], password=lambda: '')
        if 'ca_file' in result:
            ssl.create_default_context(cafile=result['ca_file'])
    return result


def generate_caddyfile(instances, https_hostname=None, auth_services=None, https_tls=None):
    validate_instances(instances)
    site_address = https_hostname if https_hostname else ":80"
    lines = []
    if https_tls is not None and https_tls['mode'] == 'provided':
        lines.extend(['{', '    auto_https disable_certs', '}', ''])
    lines.append(f"{site_address} {{")
    if https_tls is not None:
        if https_tls['mode'] == 'internal':
            lines.append('    tls internal')
        elif https_tls['mode'] == 'provided':
            lines.append('    tls /etc/caddy/tls/certificate.pem /etc/caddy/tls/key.pem')
    if auth_services:
        for name in auth_services:
            lines.extend([
                '    redir /auth /auth/',
                '    handle /auth/* {',
                f'        reverse_proxy auth-{name}:8000',
                '    }',
            ])
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

def generate_docker_compose(instances, version, https_hostname=None, auth_services=None, https_tls=None):
    validate_instances(instances)
    caddy_ports = ["80:80"]
    caddy_volumes = [
        "./Caddyfile:/etc/caddy/Caddyfile",
        "./index.html:/srv/index.html"
    ]
    volumes = {}
    if https_hostname:
        caddy_ports.extend(["443:443", "443:443/udp"])
        caddy_volumes.extend(["caddy_data:/data", "caddy_config:/config"])
        volumes.update({"caddy_data": {}, "caddy_config": {}})
    if https_tls is not None and https_tls['mode'] == 'provided':
        for field, filename in (('certificate_file', 'certificate.pem'), ('key_file', 'key.pem')):
            caddy_volumes.append({
                'type': 'bind', 'source': https_tls[field],
                'target': '/etc/caddy/tls/' + filename, 'read_only': True,
                'bind': {'create_host_path': False},
            })

    compose = {
        "services": {
            "caddy": {
                "image": "caddy:2-alpine",
                "ports": caddy_ports,
                "volumes": caddy_volumes,
                "depends_on": [f"planner-{inst['name']}" for inst in instances]
            }
        },
        "volumes": volumes
    }
    
    source_images = set()
    for inst in instances:
        name = inst['name']
        container_name = f"planner-{name}"
        
        vol_type = inst.get('volume_type', 'volume')
        if vol_type == 'bind':
            vol_source = inst.get('volume_source', f"./data/{name}")
            # Ensure host directory exists to prevent Docker creating it as root.
            # Resolve relative to 'deployment/' since docker-compose runs from there.
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
                "PLANNER_SECRET_KEY=${PLANNER_SECRET_KEY:?Set PLANNER_SECRET_KEY in the protected Compose env file}"
            ],
            "volumes": volumes,
            "restart": "unless-stopped"
        }
        if (inst.get('build_from_source') is True or 'image' not in inst) and image not in source_images:
            compose['services'][container_name]['build'] = {
                'context': str(Path(__file__).resolve().parents[1]),
                'dockerfile': 'docker/Dockerfile',
            }
            source_images.add(image)
        
      
        if vol_type == 'volume':
            compose["volumes"][vol_source] = {}
        
    add_auth_compose(compose, instances, {} if auth_services is None else auth_services, version)
    return compose

def wait_for_https(hostname, timeout=120, cafile=None):
    context = ssl.create_default_context() if cafile is None else ssl.create_default_context(cafile=cafile)
    deadline = time.monotonic() + timeout
    while True:
        try:
            with socket.create_connection(('127.0.0.1', 443), timeout=5) as connection:
                with context.wrap_socket(connection, server_hostname=hostname):
                    return
        except OSError as error:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError(f'HTTPS certificate is not ready for {hostname}: {error}') from error
            time.sleep(min(2, remaining))


def export_internal_ca(compose_command, output_dir, timeout=120):
    destination = Path(output_dir).resolve() / 'tls' / 'caddy-root.crt'
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f'Waiting up to {timeout} seconds for Caddy to create its internal CA...', flush=True)
    deadline = time.monotonic() + timeout
    previous_error = None
    while True:
        result = subprocess.run(compose_command + [
            'cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', str(destination),
        ], cwd=output_dir, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return str(destination)
        detail = result.stderr.strip()
        if not detail:
            detail = f'Docker Compose cp exited with code {result.returncode}'
        missing_root = 'could not find the file' in detail.lower() or 'no such file or directory' in detail.lower()
        if not missing_root:
            raise RuntimeError('Could not export Caddy public root certificate: ' + detail)
        if detail != previous_error:
            print('Internal CA not available yet: ' + detail, flush=True)
            previous_error = detail
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('Caddy internal CA is not ready; could not export its public root certificate: ' + detail)
        time.sleep(min(2, remaining))


def main():
    parser = argparse.ArgumentParser(
        description="Generate deployment files for PlannerTool instances and optionally start them.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        '--output-dir', default='deployment',
        help='Generated stack directory; use a distinct directory for isolated smoke stacks.'
    )
    parser.add_argument(
        '--config',
        default='instances.yml',
        help="Path to the instances configuration file.\n(default: %(default)s)"
    )
    parser.add_argument(
        '--env-file',
        help='Protected Compose environment file (mode 0600); resolved from the current directory.'
    )
    parser.add_argument(
        '--project-name',
        help='Explicit Compose project name; reuse it for every update, status and stop command.'
    )
    parser.add_argument(
        '--start',
        action='store_true',
        help="Start the docker containers after generating the files."
    )
    parser.add_argument(
        '--https-hostname',
        type=validate_https_hostname,
        metavar='HOSTNAME',
        help="Enable HTTPS for this hostname; select certificate management with manifest https_tls."
    )
    parser.add_argument(
        '-b', '--build', '--build-images',
        action='store_true',
        dest='build_images',
        help="Build all project images, then build source-declared services with their configured image tags."
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help="Write files to --output-dir, optionally build images and start containers. Without this flag, print a dry-run only."
    )
    
    args = parser.parse_args()

    compose_command = ['docker', 'compose']
    if args.project_name is not None:
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', args.project_name):
            parser.error('Compose project name must use lowercase letters, digits, underscores or hyphens')
        compose_command.extend(['--project-name', args.project_name])
    if args.env_file is not None:
        env_file = Path(args.env_file).resolve()
        if not env_file.is_file() or env_file.stat().st_mode & 0o077:
            parser.error('--env-file must reference an existing protected file (mode 0600)')
        compose_command.extend(['--env-file', str(env_file)])

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
    try:
        if 'https_hostname' in config:
            hostname = validate_https_hostname(config['https_hostname'])
            if args.https_hostname is not None and args.https_hostname != hostname:
                raise ValueError('--https-hostname conflicts with manifest https_hostname')
            args.https_hostname = hostname
        https_tls = load_https_tls(config, instances_file, args.https_hostname)
        auth_services = load_auth_services(config, instances_file, args.https_hostname,
                          output_dir=args.output_dir, apply=args.apply)
        caddy_contents = generate_caddyfile(instances, args.https_hostname, auth_services, https_tls)
        compose_obj = generate_docker_compose(instances, version, args.https_hostname, auth_services, https_tls)
        if args.project_name is not None:
            compose_obj['name'] = args.project_name
    except (ValueError, KeyError, OSError) as error:
        parser.error(str(error))
    index_contents = generate_index_html(instances)

    if args.https_hostname:
        if https_tls['mode'] == 'acme':
            print(f'Automatic HTTPS: Caddy will obtain and renew a certificate for {args.https_hostname}.')
            print('Public DNS A/AAAA records must point to this server; inbound TCP ports 80 and 443 must reach Caddy.')
            print('Caddy needs outbound DNS and HTTPS access to the certificate authority.')
        elif https_tls['mode'] == 'internal':
            print('Internal HTTPS: Caddy will issue certificates using its persistent local CA; no public ACME challenges.')
            print('After startup, install the exported public root certificate in client/browser trust stores.')
        else:
            print('Provided HTTPS: Caddy will use your certificate and key; no public ACME challenges.')
            print('You are responsible for certificate renewal and client trust in the issuing CA.')
        print(f'Clients must resolve {args.https_hostname} to this server and reach TCP port 443.')
        print('Keep the caddy_data volume and Compose project name unchanged to preserve certificates.')

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
        if not args.https_hostname:
            print('  Add --https-hostname planner.example.com to enable automatic HTTPS.')
        sys.exit(0)

    # Apply: write files into deployment/ and optionally build/start
    os.makedirs(args.output_dir, exist_ok=True)

    with open(os.path.join(args.output_dir, 'Caddyfile'), 'w') as f:
        f.write(caddy_contents)

    with open(os.path.join(args.output_dir, 'docker-compose.yml'), 'w') as f:
        yaml.dump(compose_obj, f, sort_keys=False)

    with open(os.path.join(args.output_dir, 'index.html'), 'w') as f:
        f.write(index_contents)

    print(f"Generated Caddyfile, docker-compose.yml, and index.html in '{args.output_dir}' for {len(instances)} instance(s).")

    if args.start or args.build_images:
        try:
            subprocess.run(compose_command + ['config', '--quiet'], cwd=args.output_dir, check=True)
        except subprocess.CalledProcessError as error:
            print(f'Compose configuration validation failed with code {error.returncode}; nothing was started.')
            sys.exit(error.returncode)

    if args.build_images:
        print('Building all project images...')
        try:
            subprocess.run(['bash', str(Path(__file__).resolve().with_name('build-image.sh'))],
                           cwd=args.output_dir, check=True)
        except subprocess.CalledProcessError as error:
            print(f'Project image build failed with code {error.returncode}; nothing was started.')
            sys.exit(error.returncode)

    if (args.build_images or args.start) and any('build' in service for service in compose_obj['services'].values()):
        print('Building source-declared services in the shared Compose project...')
        try:
            subprocess.run(compose_command + ['build'], cwd=args.output_dir, check=True)
        except subprocess.CalledProcessError as error:
            print(f'Compose image build failed with code {error.returncode}; nothing was started.')
            sys.exit(error.returncode)

    if args.start:
        print("Deploying instances...")
        try:
            subprocess.run(compose_command + ['up', '-d', '--wait'], cwd=args.output_dir, check=True)
            if args.https_hostname:
                print('Restarting Caddy to load the generated TLS configuration...', flush=True)
                subprocess.run(compose_command + ['restart', 'caddy'], cwd=args.output_dir, check=True)
                ca_file = https_tls.get('ca_file')
                if https_tls['mode'] == 'internal':
                    ca_file = export_internal_ca(compose_command, args.output_dir)
                    print('Public internal CA certificate: ' + ca_file)
                    print('Install this certificate in client/browser trust stores; never distribute the CA private key.')
                print('Waiting up to 120 seconds for a trusted HTTPS certificate on local port 443...')
                if ca_file is None:
                    wait_for_https(args.https_hostname)
                else:
                    wait_for_https(args.https_hostname, cafile=ca_file)
                print(f'HTTPS certificate verified for https://{args.https_hostname}/')
            print("\nDeployment successful!")

        except RuntimeError as error:
            print(f'\n{error}')
            print('Containers remain running for inspection.')
            if https_tls['mode'] == 'acme':
                print('Check public DNS (including IPv6), inbound ports 80/443, and outbound DNS/HTTPS access.')
            else:
                print('Check certificate validity, hostname SANs, issuing CA trust and local port 443.')
            print('Inspect certificate issuance errors with:')
            print('  ' + shlex.join(compose_command + [
                '--project-directory', str(Path(args.output_dir).resolve()),
                'logs', '--tail=100', 'caddy',
            ]))
            sys.exit(1)
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f'\nHTTPS setup failed: {error}')
            sys.exit(1)
        except subprocess.CalledProcessError as e:
            print(f"\nDeployment failed with error code {e.returncode}")
            sys.exit(e.returncode)
    else:
        print("\nConfiguration files generated. To start the stack, run the following command:")
        print('  ' + shlex.join(compose_command + [
            '--project-directory', str(Path(args.output_dir).resolve()), 'up', '-d', '--wait',
        ]))

if __name__ == '__main__':
    main()