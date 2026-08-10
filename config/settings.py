"""
Django settings — Xaliss
Variables d'environnement : voir .env.example
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / '.env')


def _env_bool(key: str, default: bool = False) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


def _env_list(key: str, default: str) -> list[str]:
    raw = os.environ.get(key, default)
    return [h.strip() for h in raw.split(',') if h.strip()]


# DEBUG=False par défaut : le local doit fixer DJANGO_DEBUG=true dans .env
DEBUG = _env_bool('DJANGO_DEBUG', False)

_INSECURE_SECRET_MARKERS = (
    'django-insecure-',
    'changez-moi',
    'changeme',
)


def _load_secret_key() -> str:
    from django.core.exceptions import ImproperlyConfigured

    key = (os.environ.get('DJANGO_SECRET_KEY') or '').strip()
    if not key:
        raise ImproperlyConfigured(
            'DJANGO_SECRET_KEY est obligatoire. '
            'Ajoutez-la dans .env (voir .env.example). '
            'Générer : python -c "import secrets; print(secrets.token_urlsafe(50))"'
        )
    key_lower = key.lower()
    if any(marker in key_lower for marker in _INSECURE_SECRET_MARKERS):
        raise ImproperlyConfigured(
            'DJANGO_SECRET_KEY est trop faible ou est un placeholder. '
            'Générez une clé aléatoire : '
            'python -c "import secrets; print(secrets.token_urlsafe(50))"'
        )
    if len(key) < 40:
        raise ImproperlyConfigured(
            'DJANGO_SECRET_KEY doit faire au moins 40 caractères.'
        )
    return key


SECRET_KEY = _load_secret_key()

ALLOWED_HOSTS = _env_list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'whitenoise.runserver_nostatic',
    'django.contrib.staticfiles',
    'django.contrib.sites',
    'allauth',
    'allauth.account',
    'allauth.socialaccount',
    'allauth.socialaccount.providers.google',
    'comptes',
    'finances',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'comptes.middleware.SynchroniserAbonnementMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'allauth.account.middleware.AccountMiddleware',
    'finances.middleware.ApiWriteRateLimitMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('POSTGRES_DB', 'xaliss'),
        'USER': os.environ.get('POSTGRES_USER', 'postgres'),
        'PASSWORD': os.environ.get('POSTGRES_PASSWORD', 'postgres'),
        'HOST': os.environ.get('POSTGRES_HOST', 'localhost'),
        'PORT': os.environ.get('POSTGRES_PORT', '5432'),
    }
}

AUTHENTICATION_BACKENDS = [
    'django.contrib.auth.backends.ModelBackend',
    'allauth.account.auth_backends.AuthenticationBackend',
]

SITE_ID = 1

ACCOUNT_ADAPTER = 'comptes.adapters.XalissAccountAdapter'
SOCIALACCOUNT_ADAPTER = 'comptes.adapters.XalissSocialAccountAdapter'
ACCOUNT_LOGIN_METHODS = {'email'}
ACCOUNT_SIGNUP_FIELDS = ['email*', 'password1*', 'password2*']
ACCOUNT_EMAIL_VERIFICATION = 'none'
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_QUERY_EMAIL = True
# Google (fournisseur de confiance) : connecter / connecter un compte local
# existant si l’e-mail correspond, sans passer par /auth/3rdparty/signup/.
SOCIALACCOUNT_EMAIL_AUTHENTICATION = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True

SOCIALACCOUNT_PROVIDERS = {
    'google': {
        'APP': {
            'client_id': os.environ.get('GOOGLE_CLIENT_ID', ''),
            'secret': os.environ.get('GOOGLE_CLIENT_SECRET', ''),
            'key': '',
        },
        'SCOPE': ['profile', 'email'],
        'AUTH_PARAMS': {'access_type': 'online'},
        'EMAIL_AUTHENTICATION': True,
    },
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'fr-fr'
TIME_ZONE = 'Africa/Dakar'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage',
    },
}

LOGIN_URL = 'connexion'
LOGIN_REDIRECT_URL = 'finances:application'
LOGOUT_REDIRECT_URL = 'accueil'

# E-mail : SMTP si EMAIL_HOST est renseigné (même en DEBUG), sinon console en DEBUG.
DEFAULT_FROM_EMAIL = os.environ.get('DJANGO_DEFAULT_FROM_EMAIL', 'noreply@xaliss.local')
# Formulaire landing + mailto → boîte support (vide dans .env = défaut contact@xaliss.com)
LANDING_CONTACT_EMAIL = (
    os.environ.get('LANDING_CONTACT_EMAIL', 'contact@xaliss.com') or 'contact@xaliss.com'
).strip() or 'contact@xaliss.com'
LANDING_WHATSAPP = os.environ.get('LANDING_WHATSAPP', '221772793927').strip()
LANDING_CONTACT_PHONE = os.environ.get('LANDING_CONTACT_PHONE', '+221772793927').strip()
LANDING_HORAIRES = os.environ.get('LANDING_HORAIRES', 'Lun – Ven · 9h – 18h').strip()
EMAIL_HOST = os.environ.get('EMAIL_HOST', '').strip()
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587') or '587')
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '').strip()
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = _env_bool('EMAIL_USE_TLS', not _env_bool('EMAIL_USE_SSL', False))
EMAIL_USE_SSL = _env_bool('EMAIL_USE_SSL', False)
EMAIL_TIMEOUT = int(os.environ.get('EMAIL_TIMEOUT', '20') or '20')

if EMAIL_HOST:
    EMAIL_BACKEND = os.environ.get(
        'DJANGO_EMAIL_BACKEND',
        'django.core.mail.backends.smtp.EmailBackend',
    )
elif DEBUG:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
else:
    EMAIL_BACKEND = os.environ.get(
        'DJANGO_EMAIL_BACKEND',
        'django.core.mail.backends.smtp.EmailBackend',
    )

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ——— Abonnements SaaS (Organisation) ———
# None / vide = prélaunch (essai non daté). Date ISO au lancement, ex. 2026-09-01
XALISS_LANCEMENT_LE = (os.environ.get('XALISS_LANCEMENT_LE') or '').strip() or None
XALISS_DUREE_ESSAI_JOURS = int(os.environ.get('XALISS_DUREE_ESSAI_JOURS', '90'))
# Jours d'accès après periode_fin quand statut = en_retard
XALISS_JOURS_GRACE_RETARD = int(os.environ.get('XALISS_JOURS_GRACE_RETARD', '3'))

# Backoffice ops (/backoffice/) — e-mails autorisés (séparés par des virgules)
BACKOFFICE_ALLOWED_EMAILS = _env_list(
    'BACKOFFICE_ALLOWED_EMAILS',
    'imamelhadji.msk@gmail.com',
)

# Cache local pour le rate limiting (1 process). En multi-workers, préférer Redis.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'xaliss-default',
    },
}
RATELIMIT_USE_CACHE = 'default'
RATELIMIT_ENABLE = _env_bool('DJANGO_RATELIMIT_ENABLE', True)

# ——— Sécurité production (activée si DJANGO_DEBUG=false) ———
if not DEBUG:
    SECURE_SSL_REDIRECT = _env_bool('DJANGO_SECURE_SSL_REDIRECT', True)
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31_536_000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'

CSRF_TRUSTED_ORIGINS = _env_list(
    'DJANGO_CSRF_TRUSTED_ORIGINS',
    'http://localhost:8000,http://127.0.0.1:8000',
)
