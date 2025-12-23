import brotli
from starlette.types import ASGIApp, Receive, Scope, Send

#############################################
## Brotli compression middleware for ASGI
## It does compress data about a factor 10, but it makes no difference i waiting time.
#############################################
class BrotliCompressionMiddleware:
    def __init__(self, app: ASGIApp, minimum_size: int = 300, quality: int = 4):
        self.app = app
        self.minimum_size = minimum_size
        self.quality = quality

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        accept_encoding = ''
        for h in scope.get('headers', []):
            if h[0].decode('latin1').lower() == 'accept-encoding':
                accept_encoding = h[1].decode('latin1')
                break

        if 'br' not in accept_encoding:
            await self.app(scope, receive, send)
            return

        # capture downstream messages
        messages = []

        async def send_capture(message):
            messages.append(message)

        await self.app(scope, receive, send_capture)

        # extract start and body
        start_msg = None
        body_parts = []
        for m in messages:
            if m.get('type') == 'http.response.start':
                start_msg = m
            elif m.get('type') == 'http.response.body':
                body_parts.append(m.get('body', b''))
                if not m.get('more_body'):
                    break

        if not start_msg:
            for m in messages:
                await send(m)
            return

        headers = [(k.decode('latin1').lower(), v.decode('latin1')) for k, v in start_msg.get('headers', [])]
        content_type = ''
        has_encoding = False
        for k, v in headers:
            if k == 'content-type':
                content_type = v
            if k == 'content-encoding':
                has_encoding = True

        body = b''.join(body_parts)

        # don't recompress if already encoded
        if has_encoding or not body or len(body) < self.minimum_size:
            for m in messages:
                await send(m)
            return

        if 'application/json' in content_type or content_type.startswith('text/') or 'javascript' in content_type:
            try:
                comp = brotli.compress(body, quality=self.quality)
                # build new headers
                new_headers = [(k.encode('latin1'), v.encode('latin1')) for k, v in headers if k != 'content-length']
                new_headers.append((b'content-encoding', b'br'))
                new_headers.append((b'content-length', str(len(comp)).encode('latin1')))
                new_headers.append((b'vary', b'Accept-Encoding'))
                await send({'type': 'http.response.start', 'status': start_msg.get('status'), 'headers': new_headers})
                await send({'type': 'http.response.body', 'body': comp, 'more_body': False})
                return
            except Exception:
                pass

        for m in messages:
            await send(m)
