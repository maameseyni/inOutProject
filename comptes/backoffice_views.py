from datetime import timedelta
from decimal import Decimal
from functools import wraps
from io import BytesIO
from urllib.parse import urlencode
import json

from allauth.account.models import EmailAddress
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.views import redirect_to_login
from django.core.paginator import Paginator
from django.db.models import Count, Prefetch, Q, Sum
from django.db.models.functions import Lower, TruncMonth
from django.http import FileResponse, HttpResponseForbidden
from django.shortcuts import render
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Font

from .models import (
    AbonnementOrganisation,
    MembreOrganisation,
    Organisation,
    PaiementAbonnement,
    PlanAbonnement,
)

User = get_user_model()


def _emails_backoffice_autorises():
    raw = getattr(settings, 'BACKOFFICE_ALLOWED_EMAILS', '') or ''
    if isinstance(raw, (list, tuple, set)):
        return {str(e).strip().lower() for e in raw if str(e).strip()}
    return {e.strip().lower() for e in str(raw).split(',') if e.strip()}


def backoffice_required(view_func):
    """Accès réservé aux e-mails listés dans BACKOFFICE_ALLOWED_EMAILS."""

    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return redirect_to_login(request.get_full_path(), login_url='connexion')
        email = (getattr(user, 'email', None) or user.get_username() or '').strip().lower()
        if email not in _emails_backoffice_autorises():
            return HttpResponseForbidden(
                'Accès réservé. Ce compte n’est pas autorisé au backoffice.'
            )
        return view_func(request, *args, **kwargs)

    return _wrapped


def _debut_mois_local(dt=None):
    dt = timezone.localtime(dt or timezone.now())
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _liste_mois(nb=12):
    """Liste des premiers jours de mois (local), du plus ancien au plus récent."""
    d = _debut_mois_local()
    mois = []
    for _ in range(nb):
        mois.append(d)
        d = (d - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return list(reversed(mois))


def _label_mois(d):
    mois_fr = (
        'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
        'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
    )
    return f'{mois_fr[d.month - 1]} {d.year % 100:02d}'


def _compter_par_mois(queryset, date_field, mois_list):
    """Compte les enregistrements groupés par mois pour une plage donnée."""
    if not mois_list:
        return []
    debut = mois_list[0]
    fin = mois_list[-1]
    # Fin exclusive : 1er jour du mois suivant le dernier
    if fin.month == 12:
        fin_ex = fin.replace(year=fin.year + 1, month=1)
    else:
        fin_ex = fin.replace(month=fin.month + 1)

    filtre = {f'{date_field}__gte': debut, f'{date_field}__lt': fin_ex}
    rows = (
        queryset.filter(**filtre)
        .annotate(m=TruncMonth(date_field))
        .values('m')
        .annotate(n=Count('id'))
    )
    by_key = {}
    for row in rows:
        m = row['m']
        if m is None:
            continue
        if timezone.is_aware(m):
            m = timezone.localtime(m)
        key = (m.year, m.month)
        by_key[key] = int(row['n'] or 0)

    return [by_key.get((d.year, d.month), 0) for d in mois_list]


def _sommer_par_mois(queryset, date_field, amount_field, mois_list):
    if not mois_list:
        return []
    debut = mois_list[0]
    fin = mois_list[-1]
    if fin.month == 12:
        fin_ex = fin.replace(year=fin.year + 1, month=1)
    else:
        fin_ex = fin.replace(month=fin.month + 1)

    filtre = {f'{date_field}__gte': debut, f'{date_field}__lt': fin_ex}
    rows = (
        queryset.filter(**filtre)
        .annotate(m=TruncMonth(date_field))
        .values('m')
        .annotate(total=Sum(amount_field))
    )
    by_key = {}
    for row in rows:
        m = row['m']
        if m is None:
            continue
        if timezone.is_aware(m):
            m = timezone.localtime(m)
        key = (m.year, m.month)
        val = row['total'] or Decimal('0')
        by_key[key] = float(val)

    return [by_key.get((d.year, d.month), 0.0) for d in mois_list]


def _graphiques_plateforme(nb_mois=12):
    """Séries pour les graphiques backoffice (12 mois glissants)."""
    mois_list = _liste_mois(nb_mois)
    labels = [_label_mois(d) for d in mois_list]

    inscrits_mois = _compter_par_mois(User.objects.all(), 'date_joined', mois_list)
    orgs_mois = _compter_par_mois(Organisation.objects.all(), 'cree_le', mois_list)

    paiements_ok = PaiementAbonnement.objects.filter(
        statut=PaiementAbonnement.STATUT_REUSSI,
        paye_le__isnull=False,
    )
    revenus_mois = _sommer_par_mois(paiements_ok, 'paye_le', 'montant', mois_list)

    base_avant = User.objects.filter(date_joined__lt=mois_list[0]).count()
    cumul = base_avant
    inscrits_cumul = []
    for n in inscrits_mois:
        cumul += n
        inscrits_cumul.append(cumul)

    # Connexions : utilisateurs dont last_login tombe dans le mois (approximation)
    connectes_mois = _compter_par_mois(
        User.objects.exclude(last_login__isnull=True),
        'last_login',
        mois_list,
    )

    return {
        'labels': labels,
        'inscrits_mois': inscrits_mois,
        'inscrits_cumul': inscrits_cumul,
        'orgs_mois': orgs_mois,
        'revenus_mois': revenus_mois,
        'connectes_mois': connectes_mois,
    }


def _format_montant(valeur, devise='XOF'):
    montant = valeur or Decimal('0')
    try:
        entier = int(montant)
    except (TypeError, ValueError):
        entier = 0
    texte = f'{entier:,}'.replace(',', ' ')
    return f'{texte} {devise}'


def _ids_users_email_verifie():
    return set(
        EmailAddress.objects.filter(verified=True).values_list('user_id', flat=True)
    )


def _emails_verifies():
    return set(
        EmailAddress.objects.filter(verified=True)
        .annotate(email_l=Lower('email'))
        .values_list('email_l', flat=True)
    )


def _date_relative(dt, maintenant):
    if not dt:
        return 'jamais'
    delta = maintenant - dt
    secondes = int(delta.total_seconds())
    if secondes < 0:
        return 'à venir'
    if secondes < 60:
        return "à l'instant"
    if secondes < 3600:
        return f'il y a {secondes // 60} min'
    if secondes < 86400:
        h = secondes // 3600
        return f'il y a {h} h'
    jours = secondes // 86400
    if jours < 30:
        return f'il y a {jours} j'
    mois = jours // 30
    if mois < 12:
        return f'il y a {mois} mois'
    ans = jours // 365
    return f'il y a {ans} an' + ('s' if ans > 1 else '')


def _membre_principal(user):
    membres = list(user.membres_organisations.all())
    if not membres:
        return None
    ordre = {
        MembreOrganisation.ROLE_PROPRIETAIRE: 0,
        MembreOrganisation.ROLE_ADMIN: 1,
        MembreOrganisation.ROLE_MEMBRE: 2,
    }
    membres.sort(key=lambda m: (0 if m.actif else 1, ordre.get(m.role, 9), -m.pk))
    return membres[0]


def _abonnement_of(org):
    if org is None:
        return None
    try:
        return org.abonnement
    except AbonnementOrganisation.DoesNotExist:
        return None


def _echeance_info(abo, maintenant):
    if not abo:
        return None, '—'
    if abo.statut == AbonnementOrganisation.STATUT_ESSAI:
        dt = abo.essai_fin
    elif abo.statut in (
        AbonnementOrganisation.STATUT_ACTIF,
        AbonnementOrganisation.STATUT_EN_RETARD,
    ):
        dt = abo.periode_fin
    else:
        dt = abo.periode_fin or abo.essai_fin
    if not dt:
        return None, '—'
    if dt >= maintenant:
        jours = (dt.date() - maintenant.date()).days
        if jours <= 0:
            label = "aujourd'hui"
        else:
            label = f'dans {jours} j'
    else:
        label = 'dépassée'
    return dt, label


def _derniers_paiements_par_org(org_ids):
    if not org_ids:
        return {}
    resultat = {}
    qs = (
        PaiementAbonnement.objects
        .filter(
            organisation_id__in=org_ids,
            statut=PaiementAbonnement.STATUT_REUSSI,
        )
        .order_by('organisation_id', '-paye_le', '-cree_le')
    )
    for paiement in qs:
        if paiement.organisation_id not in resultat:
            resultat[paiement.organisation_id] = paiement
    return resultat


def _lignes_utilisateurs(users, emails_verifies, maintenant, user_ids_verifies=None):
    users = list(users)
    org_ids = []
    for user in users:
        membre = _membre_principal(user)
        if membre and membre.organisation_id:
            org_ids.append(membre.organisation_id)
    derniers_paiements = _derniers_paiements_par_org(org_ids)

    lignes = []
    emails_verifies_l = {e.lower() for e in emails_verifies}
    user_ids_verifies = user_ids_verifies or set()
    for user in users:
        membre = _membre_principal(user)
        org = membre.organisation if membre else None
        abo = _abonnement_of(org)
        email = (user.email or user.username or '').strip()
        nom = user.get_full_name().strip()
        role = membre.get_role_display_label() if membre else ''
        echeance_dt, echeance_label = _echeance_info(abo, maintenant)
        paiement = derniers_paiements.get(org.pk) if org else None
        if paiement:
            date_p = paiement.paye_le or paiement.cree_le
            paiement_montant = _format_montant(paiement.montant, paiement.devise)
            paiement_date = _date_relative(date_p, maintenant)
        else:
            date_p = None
            paiement_montant = ''
            paiement_date = ''
        email_verifie = (
            user.pk in user_ids_verifies
            or email.lower() in emails_verifies_l
        )
        lignes.append({
            'email': email,
            'nom': nom,
            'role': role,
            'actif': user.is_active and (membre.actif if membre else True),
            'email_verifie': email_verifie,
            'organisation': org,
            'telephone': (org.telephone if org else '') or '',
            'plan': abo.plan.nom if abo and abo.plan_id else '—',
            'statut': abo.statut if abo else '',
            'statut_label': abo.get_statut_display() if abo else 'Sans abo',
            'echeance': echeance_dt,
            'echeance_label': echeance_label,
            'paiement_montant': paiement_montant,
            'paiement_date': paiement_date,
            'login_relatif': _date_relative(user.last_login, maintenant),
            'inscrit_relatif': _date_relative(user.date_joined, maintenant),
            'last_login': user.last_login,
            'date_joined': user.date_joined,
            'paiement_dt': date_p if paiement else None,
            'admin_user_url': f'/admin/auth/user/{user.pk}/change/',
            'admin_org_url': (
                f'/admin/comptes/organisation/{org.pk}/change/' if org else ''
            ),
            'admin_abo_url': (
                f'/admin/comptes/abonnementorganisation/{abo.pk}/change/' if abo else ''
            ),
        })
    return lignes


def _query_params(q, filtre_statut, filtre_plan, non_verifies, page=None, vue_complete=False):
    params = {}
    if q:
        params['q'] = q
    if filtre_statut:
        params['statut'] = filtre_statut
    if filtre_plan:
        params['plan'] = filtre_plan
    if non_verifies:
        params['non_verifies'] = '1'
    if vue_complete:
        params['all'] = '1'
    elif page and int(page) > 1:
        params['page'] = page
    return params


def _filtres_depuis_request(request):
    q = (request.GET.get('q') or '').strip()
    filtre_statut = (request.GET.get('statut') or '').strip()
    filtre_plan = (request.GET.get('plan') or '').strip()
    non_verifies = request.GET.get('non_verifies') in ('1', 'true', 'on')
    return q, filtre_statut, filtre_plan, non_verifies


def _queryset_utilisateurs_filtres(q, filtre_statut, filtre_plan, non_verifies):
    membres_prefetch = Prefetch(
        'membres_organisations',
        queryset=MembreOrganisation.objects.select_related(
            'organisation',
            'organisation__abonnement',
            'organisation__abonnement__plan',
        ),
    )
    users_list = (
        User.objects
        .select_related('profil')
        .prefetch_related(membres_prefetch)
        .order_by('-date_joined', '-id')
    )

    if q:
        users_list = users_list.filter(
            Q(email__icontains=q)
            | Q(username__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
            | Q(membres_organisations__organisation__nom__icontains=q)
            | Q(membres_organisations__organisation__slug__icontains=q)
        ).distinct()

    if filtre_statut:
        users_list = users_list.filter(
            membres_organisations__organisation__abonnement__statut=filtre_statut,
        ).distinct()

    if filtre_plan:
        users_list = users_list.filter(
            membres_organisations__organisation__abonnement__plan__code=filtre_plan,
        ).distinct()

    emails_verifies = _emails_verifies()
    user_ids_verifies = _ids_users_email_verifie()
    if non_verifies:
        users_list = users_list.exclude(pk__in=user_ids_verifies).annotate(
            email_l=Lower('email'),
        ).exclude(email_l__in=emails_verifies)

    return users_list, emails_verifies, user_ids_verifies


def _dt_excel(dt):
    if not dt:
        return ''
    local = timezone.localtime(dt) if timezone.is_aware(dt) else dt
    return local.strftime('%d/%m/%Y %H:%M')


def _date_excel(dt):
    if not dt:
        return ''
    local = timezone.localtime(dt) if timezone.is_aware(dt) else dt
    return local.strftime('%d/%m/%Y')


@backoffice_required
def backoffice_dashboard(request):
    maintenant = timezone.now()
    debut_mois = maintenant.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    il_y_a_30j = maintenant - timedelta(days=30)

    q, filtre_statut, filtre_plan, non_verifies = _filtres_depuis_request(request)

    abo_qs = AbonnementOrganisation.objects.select_related('organisation', 'plan')
    par_statut = {
        row['statut']: row['n']
        for row in abo_qs.values('statut').annotate(n=Count('id'))
    }
    for code, _label in AbonnementOrganisation.STATUT_CHOICES:
        par_statut.setdefault(code, 0)

    acces_ouverts = (
        par_statut[AbonnementOrganisation.STATUT_PRELAUNCH]
        + par_statut[AbonnementOrganisation.STATUT_ESSAI]
        + par_statut[AbonnementOrganisation.STATUT_ACTIF]
        + par_statut[AbonnementOrganisation.STATUT_EN_RETARD]
    )
    mrr = (
        abo_qs.filter(statut=AbonnementOrganisation.STATUT_ACTIF)
        .aggregate(total=Sum('plan__prix_mensuel'))
        .get('total')
    ) or Decimal('0')

    users_qs = User.objects.all()
    nb_users = users_qs.count()
    nb_actifs = users_qs.filter(is_active=True).count()
    connectes_30j = users_qs.filter(last_login__gte=il_y_a_30j).count()
    sans_org = users_qs.filter(membres_organisations__isnull=True).count()

    paiements_mois = PaiementAbonnement.objects.filter(
        statut=PaiementAbonnement.STATUT_REUSSI,
        paye_le__gte=debut_mois,
    ).aggregate(total=Sum('montant'), n=Count('id'))

    kpis = [
        {
            'label': 'Comptes',
            'valeur': nb_users,
            'hint': f'{nb_actifs} actifs',
            'variant': 'balance',
        },
        {
            'label': 'Entreprises',
            'valeur': Organisation.objects.count(),
            'hint': (
                f'{sans_org} compte{"s" if sans_org > 1 else ""} sans organisation'
                if sans_org
                else '0 compte sans organisation'
            ),
            'variant': 'remaining' if sans_org else 'balance',
        },
        {
            'label': 'Abonnements',
            'valeur': acces_ouverts,
            'hint': f'{par_statut[AbonnementOrganisation.STATUT_ESSAI]} essai · '
                    f'{par_statut[AbonnementOrganisation.STATUT_ACTIF]} payants',
            'variant': 'income',
        },
        {
            'label': 'Revenu prévu',
            'valeur': _format_montant(mrr),
            'hint': f'{par_statut[AbonnementOrganisation.STATUT_ACTIF]} payants',
            'variant': 'income',
        },
        {
            'label': 'Total reçu',
            'valeur': _format_montant(
                PaiementAbonnement.objects.filter(
                    statut=PaiementAbonnement.STATUT_REUSSI,
                ).aggregate(total=Sum('montant')).get('total')
            ),
            'hint': 'paiements réussis',
            'variant': 'income',
        },
        {
            'label': 'Connectés',
            'valeur': connectes_30j,
            'hint': '30 derniers jours',
            'variant': 'income' if connectes_30j else 'remaining',
        },
        {
            'label': 'Ce mois',
            'valeur': _format_montant(paiements_mois.get('total')),
            'hint': f'{paiements_mois.get("n") or 0} paiement(s)',
            'variant': 'income',
        },
        {
            'label': 'Expirés',
            'valeur': par_statut[AbonnementOrganisation.STATUT_EXPIRE],
            'hint': f'{par_statut[AbonnementOrganisation.STATUT_ANNULE]} annulé(s)',
            'variant': 'expense' if par_statut[AbonnementOrganisation.STATUT_EXPIRE] else 'balance',
        },
    ]

    users_list, emails_verifies, user_ids_verifies = _queryset_utilisateurs_filtres(
        q, filtre_statut, filtre_plan, non_verifies,
    )

    vue_complete = request.GET.get('all') in ('1', 'true', 'on')
    nb_resultats = users_list.count() if hasattr(users_list, 'count') else len(users_list)

    if vue_complete:
        page = None
        page_numbers = []
        lignes = _lignes_utilisateurs(
            users_list,
            emails_verifies,
            maintenant,
            user_ids_verifies=user_ids_verifies,
        )
    else:
        paginator = Paginator(users_list, 5)
        page = paginator.get_page(request.GET.get('page') or 1)
        lignes = _lignes_utilisateurs(
            page.object_list,
            emails_verifies,
            maintenant,
            user_ids_verifies=user_ids_verifies,
        )
        current = page.number
        total_pages = paginator.num_pages
        window_start = max(1, current - 2)
        window_end = min(total_pages, current + 2)
        page_numbers = list(range(window_start, window_end + 1))
        nb_resultats = paginator.count

    query_suffix = urlencode(
        _query_params(q, filtre_statut, filtre_plan, non_verifies, vue_complete=vue_complete)
    )
    # Liens pagination : sans all=
    query_suffix_pages = urlencode(
        _query_params(q, filtre_statut, filtre_plan, non_verifies, vue_complete=False)
    )

    total_abo = sum(par_statut.values()) or 1
    context = {
        'kpis': kpis,
        'lignes': lignes,
        'page_obj': page,
        'page_numbers': page_numbers,
        'vue_complete': vue_complete,
        'q': q,
        'filtre_statut': filtre_statut,
        'filtre_plan': filtre_plan,
        'non_verifies': non_verifies,
        'query_suffix': query_suffix,
        'query_suffix_pages': query_suffix_pages,
        'statuts_choices': AbonnementOrganisation.STATUT_CHOICES,
        'plans_choices': PlanAbonnement.objects.order_by('ordre', 'code'),
        'par_statut': [
            {
                'code': code,
                'label': label,
                'n': par_statut[code],
                'pct': round(100 * par_statut[code] / total_abo),
            }
            for code, label in AbonnementOrganisation.STATUT_CHOICES
        ],
        'mrr_formate': _format_montant(mrr),
        'nb_resultats': nb_resultats,
        'maintenant': maintenant,
        'charts_json': json.dumps(
            {
                **_graphiques_plateforme(12),
                'statuts': {
                    'labels': [label for _code, label in AbonnementOrganisation.STATUT_CHOICES],
                    'values': [par_statut[code] for code, _label in AbonnementOrganisation.STATUT_CHOICES],
                    'codes': [code for code, _label in AbonnementOrganisation.STATUT_CHOICES],
                },
            },
            ensure_ascii=False,
        ),
    }
    return render(request, 'backoffice/dashboard.html', context)


@backoffice_required
def backoffice_export_excel(request):
    """Export .xlsx des utilisateurs filtrés (mêmes filtres que le tableau)."""
    maintenant = timezone.now()
    q, filtre_statut, filtre_plan, non_verifies = _filtres_depuis_request(request)
    users_list, emails_verifies, user_ids_verifies = _queryset_utilisateurs_filtres(
        q, filtre_statut, filtre_plan, non_verifies,
    )
    lignes = _lignes_utilisateurs(
        users_list,
        emails_verifies,
        maintenant,
        user_ids_verifies=user_ids_verifies,
    )

    wb = Workbook()
    ws = wb.active
    ws.title = 'Utilisateurs'
    headers = [
        'E-mail',
        'Nom',
        'Rôle',
        'Organisation',
        'Plan',
        'Statut',
        'Échéance',
        'Téléphone',
        'Dernier paiement',
        'Date paiement',
        'E-mail vérifié',
        'Actif',
        'Dernière connexion',
        'Inscrit le',
    ]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for row in lignes:
        org = row['organisation']
        ws.append([
            row['email'],
            row['nom'] or '',
            row['role'] or '',
            (org.nom or org.slug) if org else '',
            row['plan'] if row['plan'] != '—' else '',
            row['statut_label'],
            _date_excel(row['echeance']),
            row['telephone'] or '',
            row['paiement_montant'] or '',
            _dt_excel(row.get('paiement_dt')),
            'Oui' if row['email_verifie'] else 'Non',
            'Oui' if row['actif'] else 'Non',
            _dt_excel(row.get('last_login')),
            _dt_excel(row.get('date_joined')),
        ])

    for col in ws.columns:
        max_len = 0
        letter = col[0].column_letter
        for cell in col:
            val = '' if cell.value is None else str(cell.value)
            max_len = max(max_len, len(val))
        ws.column_dimensions[letter].width = min(max_len + 2, 42)

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    stamp = timezone.localtime(maintenant).strftime('%Y%m%d-%H%M')
    filename = f'utilisateurs-xaliss-{stamp}.xlsx'
    response = FileResponse(
        buffer,
        as_attachment=True,
        filename=filename,
        content_type=(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ),
    )
    return response
