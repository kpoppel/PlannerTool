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

        response = await call_next(request)

        # If the response is already encoded, or has no body, skip compression
        if response.headers.get('content-encoding'):
            return response

        # Consume the streaming body — BaseHTTPMiddleware's call_next always
        # returns a StreamingResponse; .body is not populated on that wrapper.
        body_chunks: list = []
        async for chunk in response.body_iterator:
            body_chunks.append(chunk)
        body = b''.join(body_chunks)

        content_type = response.headers.get('content-type', '')
        compressible = (
            'application/json' in content_type
            or content_type.startswith('text/')
            or 'javascript' in content_type
        )

        if body and len(body) >= self.minimum_size and compressible:
            try:
                comp = brotli.compress(body, quality=self.quality)
                headers = dict(response.headers)
                headers.pop('content-length', None)
                headers['content-encoding'] = 'br'
                headers['vary'] = 'Accept-Encoding'
                headers['content-length'] = str(len(comp))
                return Response(content=comp, status_code=response.status_code, headers=headers)
            except Exception:
                pass

        # Return response reconstructed from the consumed body
        return Response(content=body, status_code=response.status_code, headers=dict(response.headers))
