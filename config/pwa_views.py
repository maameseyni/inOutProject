from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.http import require_GET


@require_GET
def service_worker(request):
    sw_path = Path(settings.BASE_DIR) / 'static' / 'js' / 'service-worker.js'
    content = sw_path.read_text(encoding='utf-8')
    response = HttpResponse(content, content_type='application/javascript; charset=utf-8')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return response
