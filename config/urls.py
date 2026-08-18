from django.contrib import admin
from django.urls import include, path

from comptes.backoffice.views import (
    backoffice_acces_action,
    backoffice_broadcast_notif_action,
    backoffice_charge_action,
    backoffice_dashboard,
    backoffice_export_charges_excel,
    backoffice_export_excel,
    backoffice_lancement_action,
    backoffice_org_abo_action,
    backoffice_org_detail,
    backoffice_prolonger_tous_action,
    backoffice_sondage_action,
    backoffice_user_detail,
)
from config.pwa_views import robots_txt, service_worker, sitemap_xml

urlpatterns = [
    path('admin/', admin.site.urls),
    path('backoffice/', backoffice_dashboard, name='backoffice'),
    path('backoffice/acces/action/', backoffice_acces_action, name='backoffice_acces_action'),
    path('backoffice/lancement/', backoffice_lancement_action, name='backoffice_lancement_action'),
    path(
        'backoffice/notifications/broadcast/',
        backoffice_broadcast_notif_action,
        name='backoffice_broadcast_notif_action',
    ),
    path(
        'backoffice/sondages/envoyer/',
        backoffice_sondage_action,
        name='backoffice_sondage_action',
    ),
    path(
        'backoffice/abonnements/prolonger-tous/',
        backoffice_prolonger_tous_action,
        name='backoffice_prolonger_tous_action',
    ),
    path('backoffice/charges/action/', backoffice_charge_action, name='backoffice_charge_action'),
    path('backoffice/charges/export.xlsx', backoffice_export_charges_excel, name='backoffice_export_charges_excel'),
    path('backoffice/export.xlsx', backoffice_export_excel, name='backoffice_export_excel'),
    path(
        'backoffice/utilisateurs/<int:user_id>/',
        backoffice_user_detail,
        name='backoffice_user_detail',
    ),
    path(
        'backoffice/organisations/<int:org_id>/',
        backoffice_org_detail,
        name='backoffice_org_detail',
    ),
    path(
        'backoffice/organisations/<int:org_id>/abonnement/action/',
        backoffice_org_abo_action,
        name='backoffice_org_abo_action',
    ),
    path('robots.txt', robots_txt, name='robots_txt'),
    path('sitemap.xml', sitemap_xml, name='sitemap_xml'),
    path('service-worker.js', service_worker, name='service_worker'),
    path('auth/', include('allauth.urls')),
    path('app/', include('finances.urls')),
    path('', include('comptes.urls')),
]
