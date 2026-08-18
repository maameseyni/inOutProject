from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.urls import reverse
from django.views.decorators.http import require_GET


@require_GET
def service_worker(request):
    sw_path = Path(settings.BASE_DIR) / 'static' / 'js' / 'service-worker.js'
    content = sw_path.read_text(encoding='utf-8')
    response = HttpResponse(content, content_type='application/javascript; charset=utf-8')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return response


def _absolute(request, path):
    return request.build_absolute_uri(path)


@require_GET
def robots_txt(request):
    sitemap = _absolute(request, reverse('sitemap_xml'))
    content = (
        'User-agent: *\n'
        'Allow: /\n'
        'Disallow: /app/\n'
        'Disallow: /admin/\n'
        'Disallow: /backoffice/\n'
        'Disallow: /auth/\n'
        f'Sitemap: {sitemap}\n'
    )
    return HttpResponse(content, content_type='text/plain; charset=utf-8')


@require_GET
def sitemap_xml(request):
    pages = [
        reverse('accueil'),
        reverse('connexion'),
        f'{reverse("connexion")}?onglet=inscription',
    ]
    urls = []
    for path in pages:
        loc = _absolute(request, path)
        changefreq = 'weekly' if path == reverse('accueil') else 'monthly'
        priority = '1.0' if path == reverse('accueil') else '0.7'
        urls.append(
            '  <url>\n'
            f'    <loc>{loc}</loc>\n'
            f'    <changefreq>{changefreq}</changefreq>\n'
            f'    <priority>{priority}</priority>\n'
            '  </url>'
        )
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + '\n'.join(urls)
        + '\n</urlset>\n'
    )
    return HttpResponse(content, content_type='application/xml; charset=utf-8')

