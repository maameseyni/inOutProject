from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import AuthenticationForm, SetPasswordForm
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.utils.text import slugify

from .devises import DEVISE_CHOICES, DEVISE_CHOICES_AVEC_PLACEHOLDER  # noqa: F401
from .models import MembreOrganisation, Organisation

User = get_user_model()

AUTH_INPUT_CLASS = 'auth-input'


def _auth_widget_attrs(extra=None):
    attrs = {'class': AUTH_INPUT_CLASS}
    if extra:
        attrs.update(extra)
    return attrs


class ConnexionForm(AuthenticationForm):
    username = forms.EmailField(
        label='E-mail',
        widget=forms.EmailInput(attrs=_auth_widget_attrs({
            'placeholder': 'vous@exemple.com',
            'autocomplete': 'username',
        })),
    )
    password = forms.CharField(
        label='Mot de passe',
        strip=False,
        widget=forms.PasswordInput(attrs=_auth_widget_attrs({
            'autocomplete': 'current-password',
            'placeholder': '••••••••',
        })),
    )
    remember_me = forms.BooleanField(
        label='Se souvenir de moi',
        required=False,
        widget=forms.CheckboxInput(attrs={'class': 'auth-checkbox-input'}),
    )

    error_messages = {
        'invalid_login': 'E-mail ou mot de passe incorrect.',
        'inactive': (
            'Ce compte n’est pas encore activé. '
            'Vérifiez votre e-mail ou renvoyez le lien de confirmation.'
        ),
    }

    def clean(self):
        """Distinguish compte non activé vs identifiants incorrects (ModelBackend ignore is_active)."""
        username = self.cleaned_data.get('username')
        password = self.cleaned_data.get('password')

        if username is not None and password:
            from django.contrib.auth import authenticate

            self.user_cache = authenticate(
                self.request,
                username=username,
                password=password,
            )
            if self.user_cache is None:
                candidate = (
                    User.objects.filter(username__iexact=username).first()
                    or User.objects.filter(email__iexact=username).first()
                )
                if (
                    candidate is not None
                    and candidate.check_password(password)
                    and not candidate.is_active
                ):
                    raise ValidationError(
                        self.error_messages['inactive'],
                        code='inactive',
                    )
                raise self.get_invalid_login_error()
            self.confirm_login_allowed(self.user_cache)

        return self.cleaned_data


class ReinitialiserMotDePasseForm(SetPasswordForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['new_password1'].label = 'Nouveau mot de passe'
        self.fields['new_password2'].label = 'Confirmer le mot de passe'
        for field in self.fields.values():
            widget = field.widget
            css = widget.attrs.get('class', '')
            widget.attrs['class'] = f'{css} {AUTH_INPUT_CLASS}'.strip()
            widget.attrs.setdefault('placeholder', '••••••••')


class InscriptionForm(forms.Form):
    nom_organisation = forms.CharField(
        label="Nom de l'entreprise",
        max_length=200,
        widget=forms.TextInput(attrs={'placeholder': 'Ex. Ma Boutique, Atelier…'}),
    )
    telephone = forms.CharField(
        label="Téléphone de l'entreprise",
        max_length=40,
        widget=forms.TextInput(attrs={'placeholder': '+221 77 …'}),
    )
    libelle_devise = forms.ChoiceField(
        label='Devise affichée',
        choices=DEVISE_CHOICES_AVEC_PLACEHOLDER,
        widget=forms.Select(),
    )
    email = forms.EmailField(
        label='E-mail (connexion)',
        widget=forms.EmailInput(attrs={
            'placeholder': 'vous@exemple.com',
            'autocomplete': 'email',
        }),
    )
    prenom = forms.CharField(
        label='Votre prénom',
        max_length=150,
        widget=forms.TextInput(attrs={'placeholder': 'Prénom'}),
    )
    nom = forms.CharField(
        label='Votre nom',
        max_length=150,
        widget=forms.TextInput(attrs={'placeholder': 'Nom'}),
    )
    mot_de_passe = forms.CharField(
        label='Mot de passe',
        widget=forms.PasswordInput(attrs={'autocomplete': 'new-password'}),
    )
    confirmation_mot_de_passe = forms.CharField(
        label='Confirmer le mot de passe',
        widget=forms.PasswordInput(attrs={'autocomplete': 'new-password'}),
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            widget = field.widget
            css = widget.attrs.get('class', '')
            if isinstance(widget, forms.Select):
                widget.attrs['class'] = 'kp-select-native'
            else:
                widget.attrs['class'] = f'{css} {AUTH_INPUT_CLASS}'.strip()
            if isinstance(widget, forms.PasswordInput):
                widget.attrs.setdefault('placeholder', '••••••••')

    def clean_email(self):
        email = self.cleaned_data['email'].strip().lower()
        from .utils import email_deja_utilise

        if email_deja_utilise(email):
            existant = (
                User.objects.filter(username__iexact=email).first()
                or User.objects.filter(email__iexact=email).first()
            )
            if existant is not None and not existant.is_active:
                raise ValidationError(
                    'Un compte non activé existe déjà avec cet e-mail. '
                    'Vérifiez votre boîte de réception ou renvoyez le lien de confirmation.'
                )
            raise ValidationError('Un compte existe déjà avec cet e-mail.')
        return email

    def clean_nom_organisation(self):
        nom = self.cleaned_data['nom_organisation'].strip()
        if not nom:
            raise ValidationError("Le nom de l'entreprise est obligatoire.")
        return nom

    def clean_telephone(self):
        tel = self.cleaned_data['telephone'].strip()
        if not tel:
            raise ValidationError("Le téléphone de l'entreprise est obligatoire.")
        return tel

    def clean_prenom(self):
        prenom = self.cleaned_data['prenom'].strip()
        if not prenom:
            raise ValidationError('Le prénom est obligatoire.')
        return prenom

    def clean_nom(self):
        nom = self.cleaned_data['nom'].strip()
        if not nom:
            raise ValidationError('Le nom est obligatoire.')
        return nom

    def clean(self):
        cleaned = super().clean()
        pwd = cleaned.get('mot_de_passe')
        confirm = cleaned.get('confirmation_mot_de_passe')
        if pwd and confirm and pwd != confirm:
            self.add_error('confirmation_mot_de_passe', 'Les mots de passe ne correspondent pas.')
        if pwd:
            validate_password(pwd)
        return cleaned

    def _slug_unique(self, nom: str) -> str:
        base = slugify(nom) or 'entreprise'
        slug = base
        n = 2
        while Organisation.objects.filter(slug=slug).exists():
            slug = f'{base}-{n}'
            n += 1
        return slug

    def save(self):
        email = self.cleaned_data['email']
        nom_org = self.cleaned_data['nom_organisation']
        prenom = self.cleaned_data.get('prenom', '').strip()
        nom = self.cleaned_data.get('nom', '').strip()
        telephone = self.cleaned_data['telephone'].strip()

        utilisateur = User.objects.create_user(
            username=email,
            email=email,
            password=self.cleaned_data['mot_de_passe'],
            first_name=prenom,
            last_name=nom,
            is_active=False,
        )

        organisation = Organisation.objects.create(
            slug=self._slug_unique(nom_org),
            nom=nom_org,
            telephone=telephone,
            email=email,
            libelle_devise=self.cleaned_data['libelle_devise'],
        )
        MembreOrganisation.objects.create(
            utilisateur=utilisateur,
            organisation=organisation,
            role=MembreOrganisation.ROLE_PROPRIETAIRE,
        )
        return utilisateur, organisation


class RenvoyerConfirmationEmailForm(forms.Form):
    email = forms.EmailField(
        label='E-mail',
        widget=forms.EmailInput(attrs=_auth_widget_attrs({
            'placeholder': 'vous@exemple.com',
            'autocomplete': 'email',
        })),
    )

    def clean_email(self):
        return self.cleaned_data['email'].strip().lower()


class CompleterInscriptionGoogleForm(forms.Form):
    """Après connexion Google : créer l'organisation si l'utilisateur n'en a pas."""

    prenom = forms.CharField(
        label='Votre prénom',
        max_length=150,
        widget=forms.TextInput(attrs={'placeholder': 'Prénom'}),
    )
    nom = forms.CharField(
        label='Votre nom',
        max_length=150,
        widget=forms.TextInput(attrs={'placeholder': 'Nom'}),
    )
    nom_organisation = forms.CharField(
        label="Nom de l'entreprise",
        max_length=200,
        widget=forms.TextInput(attrs={'placeholder': 'Ex. Ma Boutique, Atelier…'}),
    )
    telephone = forms.CharField(
        label="Téléphone de l'entreprise",
        max_length=40,
        widget=forms.TextInput(attrs={'placeholder': '+221 77 …'}),
    )
    libelle_devise = forms.ChoiceField(
        label='Devise affichée',
        choices=DEVISE_CHOICES_AVEC_PLACEHOLDER,
        widget=forms.Select(),
    )

    def __init__(self, *args, utilisateur=None, **kwargs):
        super().__init__(*args, **kwargs)
        if utilisateur:
            self.fields['prenom'].initial = utilisateur.first_name
            self.fields['nom'].initial = utilisateur.last_name
        for field in self.fields.values():
            widget = field.widget
            css = widget.attrs.get('class', '')
            if isinstance(widget, forms.Select):
                widget.attrs['class'] = 'kp-select-native'
            else:
                widget.attrs['class'] = f'{css} {AUTH_INPUT_CLASS}'.strip()

    def clean_prenom(self):
        prenom = self.cleaned_data['prenom'].strip()
        if not prenom:
            raise ValidationError('Le prénom est obligatoire.')
        return prenom

    def clean_nom(self):
        nom = self.cleaned_data['nom'].strip()
        if not nom:
            raise ValidationError('Le nom est obligatoire.')
        return nom

    def clean_nom_organisation(self):
        nom = self.cleaned_data['nom_organisation'].strip()
        if not nom:
            raise ValidationError("Le nom de l'entreprise est obligatoire.")
        return nom

    def clean_telephone(self):
        tel = self.cleaned_data['telephone'].strip()
        if not tel:
            raise ValidationError("Le téléphone de l'entreprise est obligatoire.")
        return tel

    def save(self, utilisateur):
        utilisateur.first_name = self.cleaned_data['prenom']
        utilisateur.last_name = self.cleaned_data['nom']
        utilisateur.save(update_fields=['first_name', 'last_name'])

        nom_org = self.cleaned_data['nom_organisation']
        telephone = self.cleaned_data['telephone'].strip()
        base = slugify(nom_org) or 'entreprise'
        slug = base
        n = 2
        while Organisation.objects.filter(slug=slug).exists():
            slug = f'{base}-{n}'
            n += 1

        organisation = Organisation.objects.create(
            slug=slug,
            nom=nom_org,
            telephone=telephone,
            email=utilisateur.email,
            libelle_devise=self.cleaned_data['libelle_devise'],
        )
        MembreOrganisation.objects.create(
            utilisateur=utilisateur,
            organisation=organisation,
            role=MembreOrganisation.ROLE_PROPRIETAIRE,
        )
        return organisation
