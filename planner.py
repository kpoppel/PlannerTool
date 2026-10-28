from planner_lib.main import Config, create_app

# Keep create_app(Config()) inside the factory to avoid import-time side-effects.
def make_app():
    """Zero-arg uvicorn factory — serves the Vite-built dist/ bundle.
       Run as: `uvicorn planner:make_app --factory --reload --port 8001`
       Note: run `npm run build` first if dist/ doesn't exist.
    """
    return create_app(Config())


def database_command(argv):
    import argparse
    import json
    import sys

    from planner_lib.migrations.contracts import SchemaError
    from planner_lib.migrations.coordinator import Database

    parser = argparse.ArgumentParser(prog='planner.py database')
    parser.add_argument('action', choices=('status', 'retry', 'restore', 'prune'))
    parser.add_argument('--data-dir', default=Config().data_dir)
    parser.add_argument('--backup', help='independent complete filesystem backup root')
    parser.add_argument('--confirm', action='store_true',
                        help='confirm loss of subsequent writes and restoration of older credentials')
    args = parser.parse_args(argv)
    database = Database(args.data_dir)
    try:
        if args.action == 'status':
            print(json.dumps(database.status(), sort_keys=True))
        elif args.action == 'retry':
            database.retry()
            print('Retry authorized. Start the server to rebuild from the unchanged source.')
        elif args.action == 'prune':
            database.prune()
            print('Database cleanup completed.')
        else:
            if not args.backup:
                parser.error('restore requires --backup and --confirm')
            print('WARNING: Restore loses subsequent writes and may restore old account keys and sessions. '
                  'Stop all writers and start a server matching the restored schema.', file=sys.stderr)
            database.restore(args.backup, confirmed=args.confirm)
            print('Independent backup activated. Start the matching server, not a newer binary.')
        return 0
    except SchemaError as error:
        print('Database operation failed: ' + str(error), file=sys.stderr)
        return 2
    except OSError as error:
        print('Database filesystem operation failed (' + type(error).__name__
              + '). Check storage space, permissions, and offline status.', file=sys.stderr)
        return 2


def main(argv=None):
    import os
    import sys

    arguments = sys.argv[1:] if argv is None else argv
    if arguments and arguments[0] == 'database':
        return database_command(arguments[1:])
    import uvicorn
    uvicorn.run('planner:make_app', factory=True, host=os.environ.get('HOST', '0.0.0.0'),
                port=int(os.environ.get('PORT', '8000')), root_path=os.environ.get('ROOT_PATH', ''))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
