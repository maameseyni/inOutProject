from django.contrib import admin
from django.urls import include, path

from comptes.backoffice_views import backoffice_dashboard, backoffice_export_excel
from config.pwa_views import service_worker

urlpatterns = [
    path('admin/', admin.site.urls),
    path('backoffice/', backoffice_dashboard, name='backoffice'),
    path('backoffice/export.xlsx', backoffice_export_excel, name='backoffice_export_excel'),
    path('service-worker.js', service_worker, name='service_worker'),
    path('auth/', include('allauth.urls')),
    path('app/', include('finances.urls')),
    path('', include('comptes.urls')),
]
