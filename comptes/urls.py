from django.urls import path

from . import views

urlpatterns = [
    path('', views.accueil, name='accueil'),
    path('connexion/', views.authentification, name='connexion'),
    path('inscription/', views.inscription, name='inscription'),
    path(
        'confirmation-email-envoyee/',
        views.confirmation_email_envoyee,
        name='confirmation_email_envoyee',
    ),
    path(
        'confirmer-email/<uidb64>/<token>/',
        views.confirmer_email,
        name='confirmer_email',
    ),
    path(
        'confirmer-changement-email/<uidb64>/<token>/',
        views.confirmer_changement_email,
        name='confirmer_changement_email',
    ),
    path(
        'renvoyer-confirmation-email/',
        views.renvoyer_confirmation_email,
        name='renvoyer_confirmation_email',
    ),
    path('completer-inscription/', views.completer_inscription, name='completer_inscription'),
    path('deconnexion/', views.DeconnexionView.as_view(), name='deconnexion'),
    path('mot-de-passe-oublie/', views.MotDePasseOublieView.as_view(), name='mot_de_passe_oublie'),
    path(
        'mot-de-passe-oublie/envoye/',
        views.MotDePasseOublieEnvoyeView.as_view(),
        name='mot_de_passe_oublie_envoye',
    ),
    path(
        'reinitialiser-mot-de-passe/<uidb64>/<token>/',
        views.ReinitialiserMotDePasseView.as_view(),
        name='reinitialiser_mot_de_passe',
    ),
    path(
        'mot-de-passe-reinitialise/',
        views.MotDePasseReinitialiseView.as_view(),
        name='mot_de_passe_reinitialise',
    ),
    path('tableau-de-bord/', views.tableau_de_bord, name='tableau_de_bord'),
]
