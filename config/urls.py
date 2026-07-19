from django.contrib import admin
from django.urls import include, path

from config.pwa_views import service_worker

urlpatterns = [
    path('admin/', admin.site.urls),
    path('service-worker.js', service_worker, name='service_worker'),
    path('auth/', include('allauth.urls')),
    path('app/', include('finances.urls')),
    path('', include('comptes.urls')),
]
