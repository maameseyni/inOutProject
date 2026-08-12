"""Tests bout en bout — charges plateforme / onglet Finances backoffice."""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from comptes.models import ChargePlateforme, PaiementAbonnement

User = get_user_model()
BO_EMAIL = 'bo-e2e-finances@test.local'


@override_settings(BACKOFFICE_ALLOWED_EMAILS=[BO_EMAIL])
class BackofficeFinancesE2ETest(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(
            username='bo_finances_e2e',
            email=BO_EMAIL,
            password='TestPass123!@#',
        )
        self.client.login(username='bo_finances_e2e', password='TestPass123!@#')

    def _csrf(self, url='/backoffice/'):
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200)
        token = r.context['csrf_token']
        return token

    def test_acces_refuse_sans_email_autorise(self):
        outsider = User.objects.create_user(
            username='outsider',
            email='outsider@example.com',
            password='TestPass123!@#',
        )
        c = Client()
        c.login(username='outsider', password='TestPass123!@#')
        r = c.get(reverse('backoffice'))
        self.assertEqual(r.status_code, 403)

    def test_dashboard_affiche_sante_et_onglet_finances(self):
        r = self.client.get(reverse('backoffice'))
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn('Santé financière', html)
        self.assertIn('data-tab="finances"', html)
        self.assertIn('panel-finances', html)
        self.assertIn('Enregistrer une dépense', html)
        self.assertIn('Encaissé', html)
        self.assertIn('Résultat net', html)

    def test_cycle_complet_charge_create_list_delete(self):
        today = timezone.localdate().isoformat()
        csrf = self._csrf()

        # Création
        r = self.client.post(
            reverse('backoffice_charge_action'),
            {
                'csrfmiddlewaretoken': csrf,
                'action': 'create',
                'date_charge': today,
                'montant': '75000',
                'categorie': ChargePlateforme.CAT_PUB,
                'libelle': 'Campagne Meta E2E',
                'notes': 'Test automatisé',
                'next': reverse('backoffice') + '#finances',
            },
            follow=True,
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(ChargePlateforme.objects.count(), 1)
        charge = ChargePlateforme.objects.get()
        self.assertEqual(charge.libelle, 'Campagne Meta E2E')
        self.assertEqual(charge.montant, Decimal('75000'))
        self.assertEqual(charge.categorie, ChargePlateforme.CAT_PUB)
        self.assertEqual(charge.cree_par_id, self.user.pk)

        html = r.content.decode()
        self.assertIn('Campagne Meta E2E', html)
        self.assertIn('75 000 XOF', html)

        # Santé financière reflète la charge
        r2 = self.client.get(reverse('backoffice'))
        self.assertIn('75 000 XOF', r2.content.decode())
        # Résultat net négatif si pas de revenus
        self.assertIn('Santé financière', r2.content.decode())

        # Partial finances (soft-nav)
        r3 = self.client.get(reverse('backoffice'), {'partial': 'finances'})
        self.assertEqual(r3.status_code, 200)
        self.assertIn('Campagne Meta E2E', r3.content.decode())

        # Refresh JSON inclut panel finances + séries charges
        r4 = self.client.get(
            reverse('backoffice'),
            {'partial': 'refresh'},
            HTTP_X_BO_PARTIAL='1',
            HTTP_ACCEPT='application/json',
        )
        self.assertEqual(r4.status_code, 200)
        data = r4.json()
        self.assertTrue(data.get('ok'))
        self.assertIn('panel-finances', data.get('html', {}))
        charts = __import__('json').loads(data.get('charts_json') or '{}')
        self.assertIn('charges_mois', charts)
        self.assertIn('resultat_net_mois', charts)
        totaux = charts.get('totaux') or {}
        self.assertEqual(float(totaux.get('charges', 0)), 75000.0)

        # Suppression
        csrf2 = self._csrf()
        r5 = self.client.post(
            reverse('backoffice_charge_action'),
            {
                'csrfmiddlewaretoken': csrf2,
                'action': 'delete',
                'charge_id': charge.pk,
                'next': reverse('backoffice') + '#finances',
            },
            follow=True,
        )
        self.assertEqual(r5.status_code, 200)
        self.assertEqual(ChargePlateforme.objects.count(), 0)
        self.assertIn('Charge supprimée', r5.content.decode())
        r6 = self.client.get(reverse('backoffice'), {'partial': 'finances'})
        self.assertNotIn('Campagne Meta E2E', r6.content.decode())
        self.assertIn('Aucune charge', r6.content.decode())

    def test_filtre_categorie_et_recherche(self):
        ChargePlateforme.objects.create(
            date_charge=timezone.localdate(),
            montant=Decimal('10000'),
            categorie=ChargePlateforme.CAT_INFRA,
            libelle='Serveur Hetzner',
        )
        ChargePlateforme.objects.create(
            date_charge=timezone.localdate(),
            montant=Decimal('5000'),
            categorie=ChargePlateforme.CAT_PUB,
            libelle='Google Ads',
        )

        r = self.client.get(
            reverse('backoffice'),
            {'charge_categorie': ChargePlateforme.CAT_PUB, 'partial': 'finances'},
        )
        html = r.content.decode()
        self.assertIn('Google Ads', html)
        self.assertNotIn('Serveur Hetzner', html)

        r2 = self.client.get(
            reverse('backoffice'),
            {'charge_q': 'Hetzner', 'partial': 'finances'},
        )
        html2 = r2.content.decode()
        self.assertIn('Serveur Hetzner', html2)
        self.assertNotIn('Google Ads', html2)

    def test_create_validation_montant_invalide(self):
        csrf = self._csrf()
        before = ChargePlateforme.objects.count()
        r = self.client.post(
            reverse('backoffice_charge_action'),
            {
                'csrfmiddlewaretoken': csrf,
                'action': 'create',
                'date_charge': timezone.localdate().isoformat(),
                'montant': '-5',
                'categorie': ChargePlateforme.CAT_AUTRE,
                'libelle': 'Invalide',
                'next': reverse('backoffice') + '#finances',
            },
            follow=True,
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(ChargePlateforme.objects.count(), before)
        self.assertIn('supérieur à zéro', r.content.decode())

    def test_resultat_net_avec_encaissement_et_charge(self):
        """Revenus − charges = résultat affiché dans les stats."""
        from comptes.models import (
            AbonnementOrganisation,
            Organisation,
            PlanAbonnement,
        )

        org = Organisation.objects.create(slug='e2e-org', nom='E2E Org')
        plan, _ = PlanAbonnement.objects.get_or_create(
            code=PlanAbonnement.CODE_PRO,
            defaults={
                'nom': 'Pro E2E',
                'prix_mensuel': Decimal('5000'),
            },
        )
        abo = AbonnementOrganisation.objects.create(
            organisation=org,
            plan=plan,
            statut=AbonnementOrganisation.STATUT_ACTIF,
        )
        PaiementAbonnement.objects.create(
            organisation=org,
            abonnement=abo,
            montant=Decimal('100000'),
            statut=PaiementAbonnement.STATUT_REUSSI,
            paye_le=timezone.now(),
        )
        ChargePlateforme.objects.create(
            date_charge=timezone.localdate(),
            montant=Decimal('30000'),
            categorie=ChargePlateforme.CAT_PUB,
            libelle='Pub E2E',
        )

        r = self.client.get(
            reverse('backoffice'),
            {'partial': 'refresh'},
            HTTP_X_BO_PARTIAL='1',
            HTTP_ACCEPT='application/json',
        )
        charts = __import__('json').loads(r.json().get('charts_json') or '{}')
        totaux = charts.get('totaux') or {}
        self.assertGreater(float(totaux.get('revenus', 0)), 0)
        self.assertEqual(float(totaux.get('charges', 0)), 30000.0)
        self.assertEqual(
            float(totaux.get('resultat_net', 0)),
            float(totaux.get('revenus', 0)) - 30000.0,
        )

        r2 = self.client.get(reverse('backoffice'))
        html = r2.content.decode()
        self.assertIn('100 000 XOF', html)
        self.assertIn('30 000 XOF', html)
        self.assertIn('70 000 XOF', html)

    def test_update_charge(self):
        charge = ChargePlateforme.objects.create(
            date_charge=timezone.localdate(),
            montant=Decimal('20000'),
            categorie=ChargePlateforme.CAT_OUTILS,
            libelle='Notion',
        )
        csrf = self._csrf()
        r = self.client.post(
            reverse('backoffice_charge_action'),
            {
                'csrfmiddlewaretoken': csrf,
                'action': 'update',
                'charge_id': charge.pk,
                'date_charge': timezone.localdate().isoformat(),
                'montant': '35000',
                'categorie': ChargePlateforme.CAT_OUTILS,
                'libelle': 'Notion Pro',
                'notes': 'Abo annuel',
                'next': reverse('backoffice') + '#finances',
            },
            follow=True,
        )
        self.assertEqual(r.status_code, 200)
        charge.refresh_from_db()
        self.assertEqual(charge.libelle, 'Notion Pro')
        self.assertEqual(charge.montant, Decimal('35000'))
        html = r.content.decode()
        self.assertIn('Notion Pro', html)
        self.assertIn('Charge modifiée', html)
        self.assertIn('bo-charge-edit-btn', html)

    def test_export_charges_excel(self):
        ChargePlateforme.objects.create(
            date_charge=timezone.localdate(),
            montant=Decimal('12000'),
            categorie=ChargePlateforme.CAT_INFRA,
            libelle='VPS Export',
        )
        r = self.client.get(reverse('backoffice_export_charges_excel'))
        self.assertEqual(r.status_code, 200)
        self.assertIn(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            r['Content-Type'],
        )
        self.assertIn('attachment', r.get('Content-Disposition', ''))
        self.assertIn('charges-xaliss-', r.get('Content-Disposition', ''))
        body = b''.join(r.streaming_content)
        self.assertGreater(len(body), 100)

    def test_finances_affiche_export_excel(self):
        r = self.client.get(reverse('backoffice'), {'partial': 'finances'})
        html = r.content.decode()
        self.assertIn('Export Excel', html)
