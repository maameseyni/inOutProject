from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.views import (
    LogoutView,
    PasswordResetCompleteView,
    PasswordResetConfirmView,
    PasswordResetDoneView,
    PasswordResetView,
)
from django.shortcuts import redirect, render
from django.urls import reverse, reverse_lazy
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode

from .emails import (
    confirmation_email_envoyee_aujourdhui,
    envoyer_confirmation_email,
    marquer_mot_de_passe_email_envoye,
    quota_mot_de_passe_atteint,
)
from .forms import (
    ConnexionForm,
    InscriptionForm,
    ReinitialiserMotDePasseForm,
    RenvoyerConfirmationEmailForm,
)
from .ratelimit_utils import flash_429, limited
from .tokens import changement_email_token, confirmation_email_token
from .utils import (
    assurer_espace_utilisateur,
    connecter_utilisateur,
    utilisateur_a_organisation,
)
from finances.services import utilisateur as user_service

User = get_user_model()


def _redirect_vers_app(onglet=None):
    url = reverse('finances:application')
    if onglet in ('transactions', 'statistiques', 'parametres'):
        return redirect(f'{url}?onglet={onglet}')
    return redirect(url)


def _message_connexion_invalide(login_form):
    if login_form.non_field_errors():
        return str(login_form.non_field_errors()[0])
    return 'E-mail ou mot de passe incorrect.'


def _message_inscription_invalide(signup_form):
    if signup_form.non_field_errors():
        return str(signup_form.non_field_errors()[0])

    priority_fields = (
        'confirmation_mot_de_passe',
        'mot_de_passe',
        'email',
        'libelle_devise',
        'nom_organisation',
        'telephone',
        'prenom',
        'nom',
    )
    for field in priority_fields:
        if field in signup_form.errors:
            return str(signup_form.errors[field][0])

    if signup_form.errors:
        first_field = next(iter(signup_form.errors))
        return str(signup_form.errors[first_field][0])

    return "Veuillez corriger les erreurs du formulaire d'inscription."


def accueil(request):
    if request.user.is_authenticated:
        return _redirect_vers_app()
    return redirect('connexion')


def _redirect_apres_connexion(request):
    if not utilisateur_a_organisation(request):
        assurer_espace_utilisateur(request.user)
    return _redirect_vers_app()


def authentification(request):
    if request.user.is_authenticated:
        return _redirect_vers_app()

    login_form = ConnexionForm()
    signup_form = InscriptionForm()
    active_tab = 'connexion'

    if request.method == 'POST':
        auth_mode = request.POST.get('auth_mode', 'connexion')
        if auth_mode == 'inscription':
            active_tab = 'inscription'
            if limited(request, group='auth_signup', rate='5/m', key='ip'):
                flash_429(request)
                return render(
                    request,
                    'comptes/authentification.html',
                    {
                        'login_form': login_form,
                        'signup_form': InscriptionForm(request.POST),
                        'active_tab': active_tab,
                    },
                )
            signup_form = InscriptionForm(request.POST)
            if signup_form.is_valid():
                utilisateur, _organisation = signup_form.save()
                try:
                    envoyer_confirmation_email(request, utilisateur)
                except Exception:
                    messages.warning(
                        request,
                        'Compte créé, mais l’envoi de l’e-mail a échoué. '
                        'Utilisez « Renvoyer le lien » ci-dessous.',
                    )
                    request.session['email_confirmation_pending'] = utilisateur.email
                    return redirect('confirmation_email_envoyee')
                request.session['email_confirmation_pending'] = utilisateur.email
                messages.success(
                    request,
                    'Compte créé. Un e-mail de confirmation vous a été envoyé.',
                )
                return redirect('confirmation_email_envoyee')
            messages.error(request, _message_inscription_invalide(signup_form))
        else:
            active_tab = 'connexion'
            if limited(request, group='auth_login', rate='10/m', key='ip'):
                flash_429(request)
                return render(
                    request,
                    'comptes/authentification.html',
                    {
                        'login_form': ConnexionForm(request, data=request.POST),
                        'signup_form': signup_form,
                        'active_tab': active_tab,
                    },
                )
            login_form = ConnexionForm(request, data=request.POST)
            if login_form.is_valid():
                utilisateur = login_form.get_user()
                remember = login_form.cleaned_data.get('remember_me')
                request.session.set_expiry(1209600 if remember else 0)
                connecter_utilisateur(request, utilisateur)
                messages.success(request, 'Connexion réussie.')
                return _redirect_apres_connexion(request)
            messages.error(request, _message_connexion_invalide(login_form))
    elif request.GET.get('onglet') == 'inscription':
        active_tab = 'inscription'

    return render(
        request,
        'comptes/authentification.html',
        {
            'login_form': login_form,
            'signup_form': signup_form,
            'active_tab': active_tab,
        },
    )


def inscription(request):
    if request.user.is_authenticated:
        return _redirect_vers_app()
    return redirect(f'{reverse("connexion")}?onglet=inscription')


def confirmation_email_envoyee(request):
    if request.user.is_authenticated:
        return _redirect_vers_app()
    email = request.session.get('email_confirmation_pending', '')
    return render(
        request,
        'comptes/confirmation_email_envoyee.html',
        {'email': email},
    )


def confirmer_email(request, uidb64, token):
    if request.user.is_authenticated:
        return _redirect_vers_app()

    utilisateur = None
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        utilisateur = User.objects.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        utilisateur = None

    if utilisateur is None or not confirmation_email_token.check_token(utilisateur, token):
        messages.error(
            request,
            'Lien de confirmation invalide ou expiré. '
            'Demandez un nouvel e-mail ci-dessous.',
        )
        return redirect('renvoyer_confirmation_email')

    if not utilisateur.is_active:
        utilisateur.is_active = True
        utilisateur.save(update_fields=['is_active'])

    request.session.pop('email_confirmation_pending', None)
    connecter_utilisateur(request, utilisateur)
    request.session.set_expiry(1209600)
    messages.success(request, 'E-mail confirmé. Bienvenue sur Xaliss !')
    return _redirect_apres_connexion(request)


def confirmer_changement_email(request, uidb64, token):
    utilisateur = None
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        utilisateur = User.objects.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        utilisateur = None

    if utilisateur is None or not changement_email_token.check_token(utilisateur, token):
        messages.error(
            request,
            'Lien de confirmation invalide ou expiré. '
            'Redemandez un changement d’e-mail depuis Paramètres.',
        )
        if request.user.is_authenticated:
            return _redirect_vers_app('parametres')
        return redirect('connexion')

    if (
        request.user.is_authenticated
        and request.user.pk != utilisateur.pk
    ):
        messages.error(
            request,
            'Ce lien correspond à un autre compte. '
            'Déconnectez-vous puis rouvrez le lien, ou utilisez le bon compte.',
        )
        return _redirect_vers_app()

    try:
        nouvel_email = user_service.appliquer_changement_email(utilisateur)
    except user_service.UtilisateurServiceError as exc:
        messages.error(request, exc.message)
        if request.user.is_authenticated:
            return _redirect_vers_app('parametres')
        return redirect('connexion')

    messages.success(
        request,
        f'E-mail mis à jour : {nouvel_email}. Utilisez-le pour vos prochaines connexions.',
    )
    if request.user.is_authenticated:
        return _redirect_vers_app('parametres')

    connecter_utilisateur(request, utilisateur)
    request.session.set_expiry(1209600)
    return _redirect_apres_connexion(request)


def renvoyer_confirmation_email(request):
    if request.user.is_authenticated:
        return _redirect_vers_app()

    initial_email = request.session.get('email_confirmation_pending', '')
    form = RenvoyerConfirmationEmailForm(initial={'email': initial_email})

    if request.method == 'POST':
        if limited(request, group='auth_resend_confirm', rate='3/m', key='ip'):
            flash_429(request)
            return render(
                request,
                'comptes/renvoyer_confirmation_email.html',
                {'form': RenvoyerConfirmationEmailForm(request.POST)},
            )
        form = RenvoyerConfirmationEmailForm(request.POST)
        if form.is_valid():
            email = form.cleaned_data['email']
            utilisateur = (
                User.objects.filter(email__iexact=email).first()
                or User.objects.filter(username__iexact=email).first()
            )
            if utilisateur is not None and not utilisateur.is_active:
                if confirmation_email_envoyee_aujourdhui(utilisateur):
                    request.session['email_confirmation_pending'] = email
                    messages.info(
                        request,
                        'Un lien de confirmation a déjà été envoyé aujourd’hui. '
                        'Vérifiez votre boîte mail ou vos spams.',
                    )
                    return redirect('confirmation_email_envoyee')
                try:
                    envoyer_confirmation_email(request, utilisateur)
                except Exception:
                    messages.error(
                        request,
                        'Impossible d’envoyer l’e-mail pour le moment. Réessayez plus tard.',
                    )
                    return render(
                        request,
                        'comptes/renvoyer_confirmation_email.html',
                        {'form': form},
                    )
            elif utilisateur is not None and utilisateur.is_active:
                messages.info(
                    request,
                    'Aucun mail de confirmation n’a été envoyé. '
                    'Si votre compte est déjà actif, connectez-vous ou utilisez '
                    '« Mot de passe oublié ».',
                )
                return redirect('connexion')
            request.session['email_confirmation_pending'] = email
            messages.success(
                request,
                'Si un compte non activé existe avec cet e-mail, '
                'un nouveau lien de confirmation a été envoyé.',
            )
            return redirect('confirmation_email_envoyee')
        messages.error(request, 'Veuillez saisir une adresse e-mail valide.')

    return render(
        request,
        'comptes/renvoyer_confirmation_email.html',
        {'form': form},
    )


def completer_inscription(request):
    """Ancienne étape Google — redirige vers l'app (profil complété dans Paramètres)."""
    if not request.user.is_authenticated:
        return redirect('connexion')
    nouvel_espace = assurer_espace_utilisateur(request.user)
    if nouvel_espace:
        messages.info(
            request,
            'Vous pouvez compléter votre profil dans Paramètres.',
        )
    return _redirect_vers_app()


class DeconnexionView(LogoutView):
    next_page = reverse_lazy('connexion')


class MotDePasseOublieView(PasswordResetView):
    template_name = 'comptes/mot_de_passe_oublie.html'
    email_template_name = 'comptes/email_reinitialisation_mot_de_passe.txt'
    html_email_template_name = 'comptes/email_reinitialisation_mot_de_passe.html'
    subject_template_name = 'comptes/email_reinitialisation_mot_de_passe_sujet.txt'
    success_url = reverse_lazy('mot_de_passe_oublie_envoye')
    extra_email_context = {'app_name': 'Xaliss'}

    def post(self, request, *args, **kwargs):
        if limited(request, group='auth_password_reset', rate='5/m', key='ip'):
            flash_429(request)
            return redirect('mot_de_passe_oublie')
        return super().post(request, *args, **kwargs)

    def form_valid(self, form):
        email = form.cleaned_data['email']
        utilisateurs = list(form.get_users(email))

        if utilisateurs and quota_mot_de_passe_atteint(email):
            messages.info(
                self.request,
                'Si un compte existe avec cet e-mail, un lien a déjà été envoyé récemment. '
                'Vérifiez votre boîte mail ou vos spams, puis réessayez demain.',
            )
            return redirect(self.get_success_url())

        response = super().form_valid(form)
        if utilisateurs:
            marquer_mot_de_passe_email_envoye(email)

        messages.success(
            self.request,
            'Si un compte existe avec cet e-mail, un lien de réinitialisation a été envoyé.',
        )
        return response

    def form_invalid(self, form):
        messages.error(self.request, 'Veuillez saisir une adresse e-mail valide.')
        return super().form_invalid(form)


class MotDePasseOublieEnvoyeView(PasswordResetDoneView):
    template_name = 'comptes/mot_de_passe_oublie_envoye.html'


class ReinitialiserMotDePasseView(PasswordResetConfirmView):
    template_name = 'comptes/reinitialiser_mot_de_passe.html'
    form_class = ReinitialiserMotDePasseForm
    success_url = reverse_lazy('mot_de_passe_reinitialise')

    def post(self, request, *args, **kwargs):
        if limited(request, group='auth_password_confirm', rate='10/m', key='ip'):
            flash_429(request)
            return redirect(request.path)
        return super().post(request, *args, **kwargs)

    def form_invalid(self, form):
        if 'new_password2' in form.errors:
            messages.error(self.request, 'Les mots de passe ne correspondent pas.')
        elif form.non_field_errors():
            messages.error(self.request, str(form.non_field_errors()[0]))
        else:
            messages.error(self.request, 'Veuillez corriger les erreurs du formulaire.')
        return super().form_invalid(form)


class MotDePasseReinitialiseView(PasswordResetCompleteView):
    template_name = 'comptes/mot_de_passe_reinitialise.html'

    def dispatch(self, request, *args, **kwargs):
        messages.success(request, 'Mot de passe réinitialisé avec succès.')
        return super().dispatch(request, *args, **kwargs)


def tableau_de_bord(request):
    if not request.user.is_authenticated:
        return redirect('connexion')

    assurer_espace_utilisateur(request.user)

    onglet = request.GET.get('onglet')
    return _redirect_vers_app(onglet)
