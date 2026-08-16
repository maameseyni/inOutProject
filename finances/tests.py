import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from comptes.models import MembreOrganisation, Organisation
from finances.models import Notification, Sondage, SondageOption, SondageReponse
from finances.services.notifications import (
    NotificationServiceError,
    create_poll_and_broadcast,
    list_notifications,
    vote_poll,
)


User = get_user_model()


class SondageNotificationTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='poll-user',
            email='poll-user@example.com',
            password='TestPass123!',
        )
        self.org = Organisation.objects.create(slug='poll-org', nom='Poll Org')
        MembreOrganisation.objects.create(
            utilisateur=self.user,
            organisation=self.org,
            role=MembreOrganisation.ROLE_PROPRIETAIRE,
        )

    def _create_poll(self):
        result = create_poll_and_broadcast(
            question='Quelle fonctionnalité en priorité ?',
            choices=['Stocks', 'Relances clients', 'Factures'],
            created_by=self.user,
        )
        return Sondage.objects.get(pk=result['poll_id'])

    def test_broadcast_expose_question_et_options_dans_notification(self):
        poll = self._create_poll()

        self.assertEqual(Notification.objects.count(), 1)
        payload = list_notifications(self.org, self.user)
        notif = payload['notifications'][0]
        self.assertEqual(notif['systemId'], f'bo_poll:{poll.pk}')
        self.assertEqual(notif['poll']['question'], poll.question)
        self.assertFalse(notif['poll']['answered'])
        self.assertEqual(
            [option['text'] for option in notif['poll']['options']],
            ['Stocks', 'Relances clients', 'Factures'],
        )

    def test_vote_api_peut_etre_modifie_sans_creer_de_doublon(self):
        poll = self._create_poll()
        options = list(poll.options.all())
        client = Client()
        self.assertTrue(client.login(username='poll-user', password='TestPass123!'))
        url = reverse('finances:api_sondage_vote', args=[poll.pk])

        response = client.post(
            url,
            data=json.dumps({'optionId': options[0].pk}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['selectedOptionId'], options[0].pk)

        second = client.post(
            url,
            data=json.dumps({'optionId': options[1].pk}),
            content_type='application/json',
        )
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json()['modified'])
        self.assertEqual(second.json()['selectedOptionId'], options[1].pk)
        self.assertEqual(SondageReponse.objects.count(), 1)
        self.assertEqual(options[0].reponses.count(), 0)
        self.assertEqual(options[1].reponses.count(), 1)

        notif = list_notifications(self.org, self.user)['notifications'][0]
        self.assertTrue(notif['poll']['answered'])
        self.assertEqual(notif['poll']['selectedOptionId'], options[1].pk)

    def test_vote_refuse_si_utilisateur_non_destinataire(self):
        poll = self._create_poll()
        outsider = User.objects.create_user(
            username='poll-outsider',
            email='poll-outsider@example.com',
            password='TestPass123!',
        )
        outsider_org = Organisation.objects.create(
            slug='poll-outsider-org',
            nom='Outsider Org',
        )
        MembreOrganisation.objects.create(
            utilisateur=outsider,
            organisation=outsider_org,
        )
        client = Client()
        client.login(username='poll-outsider', password='TestPass123!')

        response = client.post(
            reverse('finances:api_sondage_vote', args=[poll.pk]),
            data=json.dumps({'optionId': poll.options.first().pk}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(SondageReponse.objects.count(), 0)

    @override_settings(BACKOFFICE_ALLOWED_EMAILS=['poll-user@example.com'])
    def test_backoffice_cree_et_affiche_les_resultats_du_sondage(self):
        client = Client()
        client.force_login(self.user)
        response = client.post(
            reverse('backoffice_sondage_action'),
            {
                'question': 'Quel export utilisez-vous le plus ?',
                'options': ['PDF', 'Excel'],
                'next': reverse('backoffice') + '#outils',
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Sondage.objects.count(), 1)

        dashboard = client.get(reverse('backoffice'))
        self.assertEqual(dashboard.status_code, 200)
        self.assertContains(dashboard, 'Quel export utilisez-vous le plus ?')
        self.assertContains(dashboard, '0 réponse')

        poll = Sondage.objects.get()
        vote_poll(
            org=self.org,
            user=self.user,
            poll_id=poll.pk,
            option_id=poll.options.get(texte='PDF').pk,
        )
        results = client.get(reverse('backoffice'))
        self.assertContains(results, '1 réponse')
        self.assertContains(results, '100.0 %')

    @override_settings(BACKOFFICE_ALLOWED_EMAILS=['poll-user@example.com'])
    def test_backoffice_pagine_les_sondages(self):
        for index in range(5):
            poll = Sondage.objects.create(
                question=f'Question pagination {index + 1} ?',
                cree_par=self.user,
            )
            SondageOption.objects.create(sondage=poll, texte='Oui', ordre=1)
            SondageOption.objects.create(sondage=poll, texte='Non', ordre=2)

        client = Client()
        client.force_login(self.user)

        page1 = client.get(reverse('backoffice'), {'sondage_page': '1'})
        self.assertEqual(page1.status_code, 200)
        self.assertContains(page1, '5 sondages')
        self.assertContains(page1, 'Question pagination 5 ?')
        self.assertContains(page1, 'Question pagination 4 ?')
        self.assertContains(page1, 'Page 1 sur 3')
        self.assertNotContains(page1, 'Question pagination 1 ?')
        self.assertNotContains(page1, 'Question pagination 3 ?')

        page2 = client.get(reverse('backoffice'), {'sondage_page': '2'})
        self.assertEqual(page2.status_code, 200)
        self.assertContains(page2, 'Question pagination 3 ?')
        self.assertContains(page2, 'Question pagination 2 ?')
        self.assertContains(page2, 'Page 2 sur 3')
        self.assertNotContains(page2, 'Question pagination 5 ?')
        self.assertContains(page2, 'sondage_page=1')

        page3 = client.get(reverse('backoffice'), {'sondage_page': '3'})
        self.assertEqual(page3.status_code, 200)
        self.assertContains(page3, 'Question pagination 1 ?')
        self.assertContains(page3, 'Page 3 sur 3')
        self.assertNotContains(page3, 'Question pagination 5 ?')
        self.assertNotContains(page3, 'Question pagination 2 ?')

    @override_settings(BACKOFFICE_ALLOWED_EMAILS=['poll-user@example.com'])
    def test_pagination_sondages_en_partial_sans_recharger(self):
        for index in range(4):
            poll = Sondage.objects.create(
                question=f'Question partial {index + 1} ?',
                cree_par=self.user,
            )
            SondageOption.objects.create(sondage=poll, texte='Oui', ordre=1)
            SondageOption.objects.create(sondage=poll, texte='Non', ordre=2)

        client = Client()
        client.force_login(self.user)

        fragment = client.get(
            reverse('backoffice'),
            {'partial': 'polls', 'sondage_page': '2'},
            HTTP_X_REQUESTED_WITH='XMLHttpRequest',
        )
        self.assertEqual(fragment.status_code, 200)
        html = fragment.content.decode()
        self.assertIn('id="bo-sondage-results"', html)
        self.assertIn('Question partial 2 ?', html)
        self.assertNotIn('Question partial 4 ?', html)
        self.assertNotIn('panel-utilisateurs', html)
        self.assertNotIn('<body', html)

    def test_creation_refuse_un_nombre_de_choix_invalide(self):
        invalid_choices = [
            ['Un seul choix'],
            ['A', 'B', 'C', 'D', 'E', 'F'],
            ['Même choix', 'même choix'],
        ]
        for choices in invalid_choices:
            with self.subTest(choices=choices):
                with self.assertRaises(NotificationServiceError):
                    create_poll_and_broadcast(
                        question='Question invalide ?',
                        choices=choices,
                        created_by=self.user,
                    )
        self.assertEqual(Sondage.objects.count(), 0)
        self.assertEqual(Notification.objects.count(), 0)

    def test_broadcast_ne_cree_qu_une_notification_par_user_multi_org(self):
        second_org = Organisation.objects.create(slug='poll-org-2', nom='Poll Org 2')
        MembreOrganisation.objects.create(
            utilisateur=self.user,
            organisation=second_org,
            role=MembreOrganisation.ROLE_ADMIN,
        )

        poll = self._create_poll()

        notifications = Notification.objects.filter(system_id=f'bo_poll:{poll.pk}')
        self.assertEqual(notifications.count(), 1)
        self.assertEqual(notifications.get().organisation_id, self.org.pk)

    def test_vote_refuse_option_d_un_autre_sondage(self):
        first_poll = self._create_poll()
        second_poll = self._create_poll()

        with self.assertRaises(NotificationServiceError):
            vote_poll(
                org=self.org,
                user=self.user,
                poll_id=first_poll.pk,
                option_id=second_poll.options.first().pk,
            )
        self.assertEqual(SondageReponse.objects.count(), 0)

    def test_vote_refuse_sondage_ferme(self):
        poll = self._create_poll()
        poll.actif = False
        poll.save(update_fields=['actif'])

        with self.assertRaises(NotificationServiceError):
            vote_poll(
                org=self.org,
                user=self.user,
                poll_id=poll.pk,
                option_id=poll.options.first().pk,
            )
        self.assertEqual(SondageReponse.objects.count(), 0)

    @override_settings(BACKOFFICE_ALLOWED_EMAILS=['poll-user@example.com'])
    def test_backoffice_ajax_retourne_erreur_sans_creer_de_sondage(self):
        client = Client()
        client.force_login(self.user)
        response = client.post(
            reverse('backoffice_sondage_action'),
            {
                'question': 'Question sans assez de choix ?',
                'options': ['Unique'],
                'next': reverse('backoffice') + '#outils',
            },
            HTTP_X_REQUESTED_WITH='XMLHttpRequest',
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['ok'])
        self.assertEqual(response.json()['level'], 'error')
        self.assertEqual(Sondage.objects.count(), 0)
