# Mïjium — Assistant de guidage pas à pas

Application complète : backend Node.js/Express + IA via **l'API Gemini (Google)**, frontend web mobile-first, et enveloppe Android (Capacitor) pour publication sur le Play Store.

Mïjium est un assistant **généraliste** : elle ne connaît pas une activité à l'avance, elle la découvre en discutant avec l'utilisateur (sport, cuisine, langue, bricolage, révisions, projet pro… n'importe quoi), puis le guide **une étape à la fois**, sans jamais tout donner d'un coup.

---

## 1. Comment ça marche

```
mii-assistant/
├── backend/                 → serveur (API + IA + base de données + facturation + admin)
│   ├── server.js             point d'entrée
│   ├── db.js                 base SQLite (utilisateurs, sessions, messages, transactions)
│   ├── prompts.js             prompt système de Mïjium (+ tons de personnalité)
│   ├── agent.js               appel à l'API Gemini + mémoire de conversation
│   ├── billing.js             essai 7 jours + abonnement Premium (Stripe ou simulation)
│   ├── rewards.js             parrainage + paliers de gamification
│   ├── routes/                routes API (auth, chat, billing, rewards, user, admin)
│   └── .env.example           variables à configurer
├── frontend/                 → application web (interface utilisateur)
│   ├── index.html / css / js  écrans : connexion, chat, progrès, profil, admin
├── mobile-capacitor/         → enveloppe pour transformer le frontend en app Android
└── README.md                 → ce fichier
```

**Le principe** : le frontend (dans `frontend/`) parle au backend (dans `backend/`) via une API REST (`/api/...`). Le backend est le seul à appeler l'API Gemini — le frontend ne communique jamais directement avec elle, donc la clé API n'est jamais exposée au navigateur ou à l'app mobile.

### Fonctionnalités implémentées

| Fonctionnalité | Où | Détail |
|---|---|---|
| Guidage pas à pas par IA (Gemini) | `prompts.js`, `agent.js` | Prompt système qui interdit à Mïjium de tout donner d'un coup, mémoire de conversation par session |
| Évaluation initiale | `prompts.js` | Mïjium découvre l'activité et le niveau dès le premier message |
| Essai gratuit 7 jours | `billing.js` | Activé automatiquement à l'inscription |
| Quota freemium (3 sessions/jour) | `routes/chat.js` | Appliqué uniquement une fois l'essai terminé |
| Abonnement Premium (Stripe, paiement réel) | `billing.js`, `routes/billing.js` | Mode simulation par défaut, bascule vers Stripe réel dès que les clés sont renseignées ; webhook fonctionnel |
| Notification de bienvenue | `frontend/js/app.js` | Petit toast qui félicite chaque nouveau compte juste après l'inscription, et confirme un paiement Stripe réussi au retour |
| Parrainage (7 jours offerts x2) | `rewards.js` | Lien unique par utilisateur, crédité à la première conversion du filleul |
| Gamification / paliers + badge Fondateur | `rewards.js`, frontend | Séries de jours consécutifs, thèmes/bonus débloqués, badge visible pour les Premium |
| Historique des conversations | `routes/chat.js`, sidebar frontend | Renommer / supprimer une conversation, titres auto-générés |
| Export de conversation | frontend | .txt, Markdown, PDF (impression) |
| Personnalisation | `routes/user.js`, `prompts.js` | Avatar, ton de l'IA (bienveillant / professionnel / cash) |
| Thème clair / sombre | `style.css`, frontend | Bascule manuelle + respect du thème système |
| **Tableau de bord administrateur** | `routes/admin.js` | Réservé au compte `ADMIN_EMAIL` (voir `.env`) : revenus, transactions, gestion des comptes Premium |
| Interface mobile | `frontend/` | Écrans Connexion / Chat / Progrès / Profil, pensée pour un usage en app |

---

## 2. Lancer l'application en local (test complet en 5 minutes)

**Prérequis** : [Node.js 18+](https://nodejs.org) installé, et une clé API Gemini (gratuite) créée sur [Google AI Studio](https://aistudio.google.com/api-keys).

```bash
cd backend
cp .env.example .env
# ouvrez .env et renseignez au minimum :
#   GEMINI_API_KEY=votre-clé (depuis aistudio.google.com/api-keys)
#   JWT_SECRET=une-longue-chaine-aleatoire

npm install
npm start
```

Ouvrez ensuite **http://localhost:3001** (ou le `PORT` que vous avez configuré) dans votre navigateur : le serveur sert à la fois l'API et l'interface web. Créez un compte (un petit message de bienvenue s'affiche), discutez avec Mïjium, testez l'abonnement (en mode simulation, il s'active immédiatement sans carte bancaire) et le lien de parrainage.

> 💡 Sans clé Stripe dans `.env`, la facturation fonctionne en **mode simulation** : tout le parcours (essai → limite → abonnement Premium) est testable de bout en bout sans compte Stripe.

> ⚠️ Le réseau de l'environnement où ce projet a été préparé ne peut pas atteindre `generativelanguage.googleapis.com` (domaine bloqué par son proxy sortant) : le code a donc été vérifié (inscription, session, structure des appels) mais **l'appel réel à Gemini doit être testé chez vous ou une fois déployé**, où ce blocage n'existe pas.

### Ton compte administrateur

L'adresse renseignée dans `ADMIN_EMAIL` (`.env`, par défaut `anayamite@gmail.com`) est automatiquement promue **administrateur** dès qu'elle s'inscrit ou se connecte : accès Premium permanent, et un onglet **Admin** apparaît dans l'app avec le revenu total, un diagramme des 6 derniers mois, la liste de toutes les transactions et la possibilité d'offrir/révoquer le Premium de n'importe quel compte. Ce contrôle est vérifié **côté serveur** (`routes/admin.js`) : aucun autre compte ne peut y accéder, même en modifiant le frontend.

---

## 3. Activer les VRAIS paiements Stripe (obligatoire avant le lancement)

Le module `stripe` est déjà installé et le code de paiement est prêt (`billing.js`, webhook dans `routes/billing.js`). Il vous manque uniquement vos propres clés, car Claude ne peut pas créer de compte Stripe à votre place :

1. Créez un compte sur [dashboard.stripe.com](https://dashboard.stripe.com) (Stripe accepte les paiements dans la quasi-totalité des pays et gère nativement les devises locales, 3D Secure et les cartes internationales).
2. Créez un produit d'abonnement (Price récurrent mensuel) et copiez son `price_id` (commence par `price_...`).
3. Récupérez votre clé secrète (`sk_live_...` en production, `sk_test_...` pour tester) depuis Stripe → Développeurs → Clés API.
4. Renseignez dans les variables d'environnement (voir section Render ci-dessous) :
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICE_ID_PREMIUM`
   - `PUBLIC_APP_URL` (ex: `https://mijium.onrender.com`) — utilisée automatiquement pour générer les pages de retour après paiement, pas besoin de renseigner `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` séparément sauf besoin spécifique.
5. Configurez un webhook Stripe (Développeurs → Webhooks) pointant vers `https://votre-domaine/api/billing/webhook`, événement `checkout.session.completed`, et copiez le secret généré dans `STRIPE_WEBHOOK_SECRET`.

Une fois ces variables renseignées, le bouton « Passer Premium » redirige automatiquement vers une vraie page Stripe Checkout ; au retour, l'app affiche un petit toast de confirmation et chaque paiement confirmé apparaît dans le tableau de bord admin.

**Ce qui reste à me donner pour finaliser le paiement réel** : `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PREMIUM`, et éventuellement `STRIPE_WEBHOOK_SECRET` une fois le webhook créé. Donnez-les-moi (ou renseignez-les vous-même sur Render, ce qui est même plus sûr) et je branche le reste si besoin.

---

## 4. Déployer sur Render

Comme `server.js` sert à la fois l'API et le frontend, **un seul service Render suffit** :

1. Poussez ce dossier sur un dépôt GitHub (le `.gitignore` exclut déjà `.env` et la base SQLite locale — ne les committez jamais).
2. Sur [render.com](https://render.com) → **New +** → **Web Service**, connectez le dépôt.
3. Renseignez :
   - **Root Directory** : `backend`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free suffit pour démarrer (voir avertissement ci-dessous).
4. Dans l'onglet **Environment**, ajoutez toutes les variables de `.env.example` avec vos vraies valeurs (`GEMINI_API_KEY`, `JWT_SECRET`, `ADMIN_EMAIL`, les clés Stripe, `PUBLIC_APP_URL`...). Ne mettez jamais ces valeurs dans le code ou dans un fichier commité — uniquement ici, dans le tableau de bord Render.
5. Une fois déployé, Render vous donne une URL du type `https://mijium.onrender.com` : renseignez-la dans `PUBLIC_APP_URL` (puis redéployez) et, si vous construisez l'app Android, dans `frontend/js/config.js` (`window.MII_API_BASE_URL`).

### ⚠️ Persistance des données (important)

Ce projet stocke tout (comptes, conversations, transactions) dans un fichier SQLite local (`backend/data/mii.sqlite3`). Sur Render, le disque d'un service **Free** ou **Starter sans disque** est **éphémère** : son contenu est perdu à chaque redéploiement ou redémarrage. Pour une vraie mise en production (avec de vrais paiements), faites l'une des deux choses suivantes :

- **Option simple** : ajoutez un [disque persistant Render](https://render.com/docs/disks) (payant, à partir de 1 Go), monté par exemple sur `/var/data`, puis réglez `DATA_DIR=/var/data` dans les variables d'environnement.
- **Option plus robuste à terme** : migrer vers une base [PostgreSQL managée par Render](https://render.com/docs/databases) (gratuite pour démarrer). Cette migration n'est pas incluse dans ce projet — dites-moi si vous voulez que je la fasse.

---

## 5. Construire l'app Android (pour le Play Store)

⚠️ Point important : le code fourni est une **application web**. Pour obtenir un fichier installable sur le Play Store (`.aab`), il faut l'empaqueter avec [Capacitor](https://capacitorjs.com/), ce qui nécessite **Android Studio installé sur votre ordinateur** (impossible à faire dans cet environnement de chat). Voici la marche à suivre exacte :

### Étape 1 — Backend déjà en ligne (fait à l'étape 4)
Le téléphone de vos utilisateurs ne peut pas appeler `localhost` : il utilisera l'URL Render (`https://mijium.onrender.com` par exemple).

### Étape 2 — Pointer le frontend vers ce backend
Éditez `frontend/js/config.js` :
```js
window.MII_API_BASE_URL = "https://mijium.onrender.com";
```

### Étape 3 — Créer le projet Android
```bash
cd mobile-capacitor
npm install
mkdir www
cp -r ../frontend/* www/
npx cap add android
npx cap sync android
npx cap open android
```
Android Studio s'ouvre alors avec le projet. Vous pouvez y personnaliser l'icône (remplacez `frontend/icons/icon.svg` par vos propres icônes PNG aux formats requis — [générateur officiel](https://developer.android.com/studio/write/image-asset-studio)), le nom (`appName` dans `capacitor.config.json`), et lancer **Build > Generate Signed Bundle / APK** pour produire le fichier `.aab` à envoyer sur le Play Store.

### Étape 4 — Recommencer à chaque changement du frontend
Après toute modification dans `frontend/`, relancez `cp -r ../frontend/* www/ && npx cap sync android`.

---

## 6. ⚠️ Conformité Play Store — à lire avant de soumettre

Ces points sont **exigés par Google**, pas optionnels :

1. **Facturation des abonnements numériques** : Google impose que tout abonnement à du contenu numérique vendu *dans* une app Android passe par **Google Play Billing**, pas par Stripe ni un autre moyen de paiement direct dans l'app. Le module `billing.js` fourni (Stripe/simulation) convient pour une **version web**, mais pour la version Android publiée sur le Play Store, vous devrez intégrer la [Play Billing Library](https://developer.android.com/google/play/billing) (ou un plugin Capacitor comme `cordova-plugin-purchase`) et adapter `routes/billing.js` pour valider les achats côté serveur via l'API Google Play Developer. C'est une étape de développement à part entière, non incluse ici.
2. **Politique de confidentialité** : obligatoire, avec une URL publique renseignée dans la Play Console (Mïjium collecte des e-mails, mots de passe et messages de conversation).
3. **Formulaire "Sécurité des données"** de la Play Console : à remplir en cohérence avec ce que l'app collecte réellement (e-mail, contenu des conversations, statut d'abonnement).
4. **Résiliation en un clic** : la loi (et Google) exige un moyen simple de résilier — le bouton "Résilier le renouvellement" du profil existe déjà, à relier à votre vraie logique Play Billing.
5. **Compte développeur Google Play** (25 $ à vie) et passage par un test interne/fermé avant la publication publique.
6. **target API level** : Google exige de cibler une version d'Android récente (vérifiez l'exigence en vigueur au moment de la soumission sur la Play Console).

---

## 7. Sécurité — points déjà couverts

- Mots de passe hachés (bcrypt), jamais stockés en clair.
- Le backend est le seul à détenir la clé `GEMINI_API_KEY` : elle n'est jamais envoyée au frontend ni à l'app Android.
- Jetons de connexion signés (JWT), expiration à 30 jours.
- Limitation de débit sur l'API (`express-rate-limit`) pour éviter les abus (protège aussi votre quota Gemini/Stripe).
- `.env` est exclu du dépôt git (`.gitignore`) — ne le committez jamais, et sur Render renseignez les secrets uniquement dans l'onglet **Environment**.
- Si une clé (Gemini, Stripe...) a un jour été visible ailleurs que dans vos propres `.env`/variables d'environnement (capture d'écran partagée, dépôt public, etc.), régénérez-la depuis Google AI Studio ou Stripe par précaution — c'est gratuit et instantané.

À ajouter vous-même avant une mise en production à grande échelle : HTTPS sur votre backend (fourni automatiquement par Render), sauvegardes régulières de la base (voir section 4 sur la persistance), et migration vers PostgreSQL si le nombre d'utilisateurs devient important.

---

## 8. Idées d'évolution

- Notifications push pour relancer un utilisateur avant la fin de son essai ou de sa série.
- Export du guide de connaissance métier si vous voulez spécialiser Mïjium sur un domaine précis (remettre un fichier `knowledge/guide_activite.md` injecté dans `prompts.js`).
- Tableau de bord de progression plus détaillé (graphiques) pour les comptes Premium, comme évoqué dans le cahier des charges initial.
