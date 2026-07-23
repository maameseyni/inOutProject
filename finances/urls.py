from django.urls import path

from . import api_views, views

app_name = 'finances'

urlpatterns = [
    path('', views.application, name='application'),
    path('api/transactions/', api_views.transactions_list_create, name='api_transactions'),
    path(
        'api/transactions/<str:transaction_id>/',
        api_views.transaction_detail,
        name='api_transaction_detail',
    ),
    path(
        'api/transactions/<str:transaction_id>/completer/',
        api_views.transaction_completer,
        name='api_transaction_completer',
    ),
    path('api/clients/', api_views.clients_list_create, name='api_clients'),
    path('api/clients/<str:client_id>/', api_views.client_detail, name='api_client_detail'),
    path('api/notes/', api_views.notes_list_create, name='api_notes'),
    path('api/notes/rappels-email/', api_views.notes_process_reminder_emails, name='api_notes_rappels_email'),
    path('api/notes/<str:note_id>/', api_views.note_detail, name='api_note_detail'),
    path('api/notifications/', api_views.notifications_list_create_clear, name='api_notifications'),
    path(
        'api/notifications/remove-prefix/',
        api_views.notifications_remove_by_prefix,
        name='api_notifications_remove_prefix',
    ),
    path(
        'api/notifications/<str:notif_id>/',
        api_views.notification_detail,
        name='api_notification_detail',
    ),
    path('api/categories/', api_views.categories_list_replace, name='api_categories'),
    path('api/organisation/profil/', api_views.organisation_profil, name='api_organisation_profil'),
    path('api/utilisateur/profil/', api_views.utilisateur_profil, name='api_utilisateur_profil'),
    path('api/utilisateur/mot-de-passe/', api_views.utilisateur_mot_de_passe, name='api_utilisateur_mot_de_passe'),
    path('api/sync/', api_views.sync_status, name='api_sync'),
    path('api/verrous/', api_views.verrous_edition, name='api_verrous'),
]
