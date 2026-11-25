"""Prevent a worker from serving an old generation across logical restore."""
from starlette.responses import JSONResponse


RESTORE_PATH = '/admin/v1/restore'


class GenerationRestoreGuard:
    def __init__(self, app, handle):
        self.app = app
        self.handle = handle
        self.active_requests = 0
        self.restoring = False

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return
        if self.handle.restart_required or self.restoring:
            error = 'restart_required' if self.handle.restart_required else 'restore_in_progress'
            await JSONResponse({'error': error}, status_code=503)(scope, receive, send)
            return
        path = scope['path'].removeprefix(scope.get('root_path', ''))
        restoring = scope['method'] == 'POST' and path.rstrip('/') == RESTORE_PATH
        if restoring and self.active_requests:
            await JSONResponse({'error': 'restore_busy', 'message': 'Wait for active requests and retry.'},
                               status_code=409)(scope, receive, send)
            return
        self.restoring = restoring
        self.active_requests += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.active_requests -= 1
            if restoring:
                self.restoring = False