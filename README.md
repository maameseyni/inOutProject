# 🖨️ KaayPrint - Gestion Financière

Application web de gestion financière pour l'agence d'imprimerie KaayPrint.

## 📋 Fonctionnalités

- ✅ **Facture** : aperçu, impression, export PNG ; client / destinataire optionnel ; QR code site/WhatsApp (si renseigné en paramètres) ; pied de remerciement.
- ✅ **Paramètres** : onglet avec les coordonnées sur la facture (Firebase / cache local) ; **QR code** généré à partir du site / WhatsApp (aperçu, téléchargement PNG, partage ; le même QR apparaît sur la facture).
- ✅ **Ajout d'entrants** : Enregistrer les paiements des clients
- ✅ **Ajout de sortants** : Enregistrer les achats et dépenses
- ✅ **Calcul automatique** : Affichage en temps réel de la recette actuelle
- ✅ **Historique complet** : Liste de toutes les transactions avec filtres
- ✅ **Sauvegarde locale** : Les données sont sauvegardées dans le navigateur
- ✅ **Interface moderne** : Design professionnel et responsive

## 🚀 Utilisation

1. Ouvrez le fichier `index.html` dans votre navigateur web
2. Ajoutez vos entrants (revenus) et sortants (dépenses)
3. La recette est calculée et affichée automatiquement en temps réel

## 🖼️ Export facture (PNG) et navigateur

Chrome et Edge bloquent souvent l’export PNG quand la page est ouverte en **`file://`** (double-clic sur `acceuil.html`). Dans ce cas, utilisez un **petit serveur local** :

1. Double-cliquez sur **`start-local-server.bat`** (Python requis), **ou** dans un terminal :  
   `cd` dans le dossier du projet puis `python -m http.server 8080`
2. Ouvrez **`http://localhost:8080/index.html`** (puis connectez-vous comme d’habitude).

L’export **Télécharger / Partager** de la facture fonctionne alors comme prévu. Sinon vous pouvez toujours utiliser **Imprimer** puis **Enregistrer en PDF**.

## 💾 Stockage des données

Les données sont sauvegardées dans le **localStorage** du navigateur. Cela signifie que :
- Les données restent même après fermeture du navigateur
- Chaque navigateur/ordinateur a ses propres données
- Les **coordonnées sur la facture** : avec **Firebase** actif, elles sont enregistrées dans Firestore (`companyProfiles/{compte}`), une fiche par utilisateur connecté (aujourd’hui l’identifiant = le **login** de session ; après inscription ce sera typiquement l’**UID** Firebase Auth). Un cache local par compte garde une copie sur l’appareil.
- Pour partager avec votre collègue, vous pouvez utiliser le même navigateur ou exporter/importer les données

### Règles Firestore (transactions + profil facture)

Si vous voyez **« Missing or insufficient permissions »** sur le profil entreprise, la collection **`companyProfiles`** n’est pas autorisée dans vos règles.

1. Ouvrez [Firebase Console](https://console.firebase.google.com/) → votre projet → **Firestore Database** → onglet **Règles**.
2. Assurez-vous d’avoir **à la fois** `transactions` et `companyProfiles` (voir le fichier **`firestore.rules`** à la racine du dépôt pour un exemple complet).
3. Cliquez sur **Publier**.

Exemple minimal (même principe que dans `firestore.rules`) :

```
match /companyProfiles/{userId} {
  allow read, write: if true;
}
```

À durcir plus tard avec **Firebase Authentication** (`request.auth.uid == userId`).

## 📱 Responsive

L'application est entièrement responsive et fonctionne sur :
- Ordinateurs de bureau
- Tablettes
- Smartphones

## 🎨 Interface

- **Carte Balance** : Affiche la recette actuelle (entrants - sortants)
- **Carte Total Entrants** : Somme de tous les revenus
- **Carte Total Sortants** : Somme de toutes les dépenses
- **Formulaires** : Pour ajouter facilement des transactions
- **Historique** : Liste complète avec possibilité de filtrer et supprimer

## 🔄 Synchronisation

Pour que votre collègue soit au courant en temps réel, vous pouvez :
1. Utiliser le même ordinateur/navigateur
2. Partager l'écran via une application de visioconférence
3. Exporter/Importer les données (fonctionnalité à venir)

---

**Développé pour KaayPrint** 🖨️

