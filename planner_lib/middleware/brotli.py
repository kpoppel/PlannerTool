import brotli
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

#############################################
## Brotli compression middleware
## Compresses response bodies when client supports 'br'.
#############################################
class BrotliCompression(BaseHTTPMiddleware):
    def __init__(self, app, minimum_size: int = 300, quality: int = 4):
        super().__init__(app)
        self.minimum_size = minimum_size
        self.quality = quality

    async def dispatch(self, request: Request, call_next):
        accept_encoding = request.headers.get('accept-encoding', '')
        if 'br' not in accept_encoding.lower():
            return await call_next(request)

        response: Response = await call_next(request)

        # If the response is already encoded, or has no body, skip compression
        if response.headers.get('content-encoding'):
            return response

        body = response.body or b''
        if not body or len(body) < self.minimum_size:
            return response

        content_type = response.headers.get('content-type', '')
        if 'application/json' in content_type or content_type.startswith('text/') or 'javascript' in content_type:
            try:
                comp = brotli.compress(body, quality=self.quality)
                response.body = comp
                response.headers.pop('content-length', None)
                response.headers['content-encoding'] = 'br'
                response.headers['vary'] = 'Accept-Encoding'
                response.headers['content-length'] = str(len(comp))
            except Exception:
                # If compression fails, return original response unchanged
                return response

        return response
