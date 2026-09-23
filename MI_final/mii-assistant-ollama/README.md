# Mïjium — Assistant de guidage pas à pas

Application complète : backend Node.js/Express + IA locale via Ollama (llama3), frontend web mobile-first, et enveloppe Android (Capacitor) pour publication sur le Play Store.

Mïjium est un assistant **généraliste** : elle ne connaît pas une activité à l'avance, elle la découvre en discutant avec l'utilisateur (sport, cuisine, langue, bricolage, révisions, projet pro… n'importe quoi), puis le guide **une étape à la fois**, sans jamais tout donner d'un coup.

---

## 1. Comment ça marche

```
mii-assistant/
├── backend/                 → serveur (API + IA + base de données + facturation + admin)
│   ├── server.js             point d'entrée
│   ├── db.js                 base SQLite (utilisateurs, sessions, messages, transactions)
│   ├── prompts.js             prompt système de Mïjium (+ tons de personnalité)
│   ├── agent.js               appel à Ollama (local) + mémoire de conversation
│   ├── billing.js             essai 7 jours + abonnement Premium (Stripe ou simulation)
│   ├── rewards.js             parrainage + paliers de gamification
│   ├── routes/                routes API (auth, chat, billing, rewards, user, admin)
│   └── .env.example           variables à configurer
├── frontend/                 → application web (interface utilisateur)
│   ├── index.html / css / js  écrans : connexion, chat, progrès, profil, admin
├── mobile-capacitor/         → enveloppe pour transformer le frontend en app Android
└── README.md                 → ce fichier
```

**Le principe** : le frontend (dans `frontend/`) parle au backend (dans `backend/`) via une API REST (`/api/...`). Le backend est le seul à appeler le serveur Ollama (en local, sur `http://localhost:11434` par défaut) — le frontend ne communique jamais directement avec le modèle, ce qui reste la bonne pratique même sans clé API à protéger.

### Fonctionnalités implémentées

| Fonctionnalité | Où | Détail |
|---|---|---|
| Guidage pas à pas par IA | `prompts.js`, `agent.js` | Prompt système qui interdit à Mïjium de tout donner d'un coup, mémoire de conversation par session |
| Évaluation initiale | `prompts.js` | Mïjium découvre l'activité et le niveau dès le premier message |
| Essai gratuit 7 jours | `billing.js` | Activé automatiquement à l'inscription |
| Quota freemium (3 sessions/jour) | `routes/chat.js` | Appliqué uniquement une fois l'essai terminé |
| Abonnement Premium (Stripe) | `billing.js`, `routes/billing.js` | Mode simulation par défaut, bascule vers Stripe réel si vous renseignez des clés ; webhook fonctionnel |
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

**Prérequis** : [Node.js 18+](https://nodejs.org) installé, et [Ollama](https://ollama.com) installé en local avec un modèle téléchargé.

```bash
# 1) Installer et lancer Ollama, puis télécharger le modèle (une seule fois)
ollama pull llama3
ollama serve   # laissez ce terminal ouvert (Ollama écoute sur http://localhost:11434)
```

```bash
# 2) Dans un autre terminal, configurer et lancer le backend
cd backend
cp .env.example .env
# ouvrez .env et renseignez au minimum :
#   JWT_SECRET=une-longue-chaine-aleatoire
# (OLLAMA_BASE_URL et OLLAMA_MODEL ont déjà de bonnes valeurs par défaut)

npm install
npm start
```

Ouvrez ensuite **http://localhost:3000** dans votre navigateur : le serveur sert à la fois l'API et l'interface web. Créez un compte, discutez avec Mïjium, testez l'abonnement (en mode simulation, il s'active immédiatement sans carte bancaire) et le lien de parrainage.

> Note : `llama3` est un modèle généraliste raisonnablement léger, mais reste bien plus limité que Claude — attendez-vous à des réponses moins fines, surtout pour respecter la consigne « une étape à la fois » du prompt système. Vous pouvez essayer un autre modèle Ollama (`ollama pull mistral`, `ollama pull llama3.1`, etc.) en changeant `OLLAMA_MODEL` dans `.env`.

> 💡 Sans clé Stripe dans `.env`, la facturation fonctionne en **mode simulation** : tout le parcours (essai → limite → abonnement Premium) est testable de bout en bout sans compte Stripe.

### Ton compte administrateur

L'adresse renseignée dans `ADMIN_EMAIL` (`.env`, par défaut `anayamite@gmail.com`) est automatiquement promue **administrateur** dès qu'elle s'inscrit ou se connecte : accès Premium permanent, et un onglet **Admin** apparaît dans l'app avec le revenu total, un diagramme des 6 derniers mois, la liste de toutes les transactions et la possibilité d'offrir/révoquer le Premium de n'importe quel compte. Ce contrôle est vérifié **côté serveur** (`routes/admin.js`) : aucun autre compte ne peut y accéder, même en modifiant le frontend.

### Activer les vrais paiements Stripe (recommandé pour la mise en production)

Le module `stripe` est déjà installé et le code de paiement est prêt (`billing.js`, webhook dans `routes/billing.js`). Il vous manque uniquement vos propres clés, car Claude ne peut pas créer de compte Stripe à votre place :
1. Créez un compte sur [dashboard.stripe.com](https://dashboard.stripe.com) (Stripe accepte les paiements dans la quasi-totalité des pays et gère nativement les devises locales, 3D Secure et les cartes internationales — c'est la solution la plus fiable pour un lancement mondial).
2. Créez un produit d'abonnement (Price récurrent mensuel) et copiez son `price_id`.
3. Renseignez dans `.env` : `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PREMIUM`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`.
4. Configurez un webhook Stripe pointant vers `https://votre-domaine/api/billing/webhook` (événement `checkout.session.completed`) et copiez le secret dans `STRIPE_WEBHOOK_SECRET`.

Une fois ces variables renseignées, le bouton « Passer Premium » redirige automatiquement vers une vraie page de paiement Stripe Checkout, et chaque paiement confirmé apparaît dans le tableau de bord admin.

---

## 3. Construire l'app Android (pour le Play Store)

⚠️ Point important : le code fourni est une **application web**. Pour obtenir un fichier installable sur le Play Store (`.aab`), il faut l'empaqueter avec [Capacitor](https://capacitorjs.com/), ce qui nécessite **Android Studio installé sur votre ordinateur** (impossible à faire dans cet environnement de chat). Voici la marche à suivre exacte :

### Étape 1 — Héberger le backend en ligne
Le téléphone de vos utilisateurs ne peut pas appeler `localhost`. Déployez le dossier `backend/` sur un hébergeur (Railway, Render, Fly.io, un VPS...), avec les mêmes variables d'environnement que dans `.env`. Notez l'URL publique, ex. `https://api.mon-app-mii.com`.

### Étape 2 — Pointer le frontend vers ce backend
Éditez `frontend/js/config.js` :
```js
window.MII_API_BASE_URL = "https://api.mon-app-mii.com";
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

## 4. ⚠️ Conformité Play Store — à lire avant de soumettre

Ces points sont **exigés par Google**, pas optionnels :

1. **Facturation des abonnements numériques** : Google impose que tout abonnement à du contenu numérique vendu *dans* une app Android passe par **Google Play Billing**, pas par Stripe ni un autre moyen de paiement direct dans l'app. Le module `billing.js` fourni (Stripe/simulation) convient pour une **version web**, mais pour la version Android publiée sur le Play Store, vous devrez intégrer la [Play Billing Library](https://developer.android.com/google/play/billing) (ou un plugin Capacitor comme `cordova-plugin-purchase`) et adapter `routes/billing.js` pour valider les achats côté serveur via l'API Google Play Developer. C'est une étape de développement à part entière, non incluse ici.
2. **Politique de confidentialité** : obligatoire, avec une URL publique renseignée dans la Play Console (Mïjium collecte des e-mails, mots de passe et messages de conversation).
3. **Formulaire "Sécurité des données"** de la Play Console : à remplir en cohérence avec ce que l'app collecte réellement (e-mail, contenu des conversations, statut d'abonnement).
4. **Résiliation en un clic** : la loi (et Google) exige un moyen simple de résilier — le bouton "Résilier le renouvellement" du profil existe déjà, à relier à votre vraie logique Play Billing.
5. **Compte développeur Google Play** (25 $ à vie) et passage par un test interne/fermé avant la publication publique.
6. **target API level** : Google exige de cibler une version d'Android récente (vérifiez l'exigence en vigueur au moment de la soumission sur la Play Console).

---

## 5. Sécurité — points déjà couverts

- Mots de passe hachés (bcrypt), jamais stockés en clair.
- Le modèle IA tourne en local via Ollama : aucune donnée de conversation n'est envoyée à un service tiers, et il n'y a pas de clé API à protéger.
- Jetons de connexion signés (JWT), expiration à 30 jours.
- Limitation de débit sur l'API (`express-rate-limit`) pour éviter les abus.
- Si vous déployez ce backend sur un serveur distant, gardez à l'esprit qu'Ollama doit tourner sur (ou être joignable depuis) cette même machine — ce n'est pas un service géré comme l'API Anthropic.

À ajouter vous-même avant une mise en production à grande échelle : HTTPS sur votre backend (généralement fourni automatiquement par l'hébergeur), sauvegardes régulières du fichier `backend/data/mii.sqlite3`, et migration vers PostgreSQL si le nombre d'utilisateurs devient important (SQLite convient très bien jusqu'à plusieurs milliers d'utilisateurs actifs).

---

## 6. Idées d'évolution

- Notifications push pour relancer un utilisateur avant la fin de son essai ou de sa série.
- Export du guide de connaissance métier si vous voulez spécialiser Mïjium sur un domaine précis (remettre un fichier `knowledge/guide_activite.md` injecté dans `prompts.js`).
- Tableau de bord de progression plus détaillé (graphiques) pour les comptes Premium, comme évoqué dans le cahier des charges initial.
