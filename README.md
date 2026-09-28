# Exam237 V5 — PWA

Cette version remplace l'ancienne interface HTML par une application unique **Next.js + TypeScript + React**, pensée d'abord pour le téléphone.

## Vision appliquée

- Une seule application : pas de page « espace élève » séparée, ni de site admin différent.
- Couleurs du logo Exam237 : vert, blanc, doré, rouge uniquement pour les alertes.
- Navigation mobile : **Accueil · Sujets · Chat · Profil**. Le compte admin voit aussi **Admin**.
- Inscription → compte **En attente** → activation directe par l'admin, sans clé.
- Les classes et groupes viennent de Neon et sont créables depuis l'administration.
- Une nouvelle classe apparaît automatiquement au formulaire d'inscription.
- La création d'un groupe crée automatiquement son salon de chat.
- Première C/D/TI et Terminale C/D/TI partagent chacun leurs contenus et leur chat de groupe.
- Les sujets déjà présents dans Neon sont réutilisés : aucun PDF publié n'est copié ni supprimé par cette migration de code.
- Suppression définitive d'un élève, d'un sujet ou d'une correction disponible depuis l'admin avec confirmation.
- Chat chiffré avec **AES-256-GCM**, clé distincte dérivée par salon.
- Temps réel via **Ably** ; si Ably n'est pas encore configuré, le chat bascule automatiquement sur une synchronisation toutes les 3,5 secondes.
- PWA installable sur Android/iPhone compatibles. Les PDF protégés et le chat nécessitent Internet.

## Base de données

Cette V5 utilise directement la structure Neon déjà appliquée à Exam237 :

- `ex237_groups`
- `ex237_classes`
- `ex237_user_profiles`
- `ex237_subjects`
- `ex237_class_subjects`
- `ex237_papers`
- `ex237_corrections`
- `ex237_chat_rooms`
- `ex237_chat_messages`
- `ex237_chat_reports`
- `ex237_password_reset_tokens`
- `jl_users`
- `jl_sessions`

**Aucune nouvelle migration SQL n'est nécessaire pour cette archive.**

## Variables Vercel requises

Conserver les variables déjà présentes et ajouter :

```text
DATABASE_URL=...
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
APP_URL=https://exam237.vercel.app
BLOB_READ_WRITE_TOKEN=...
CHAT_MASTER_KEY=...
ABLY_API_KEY=...
RESEND_API_KEY=...
RESET_EMAIL_FROM=Exam237 <noreply@votre-domaine.com>
```

### CHAT_MASTER_KEY

Utiliser une valeur aléatoire d'au moins 32 caractères. Une valeur de 48 à 64 caractères est préférable.

**Ne jamais la mettre dans GitHub et ne jamais la changer après le lancement du chat.** Si elle est remplacée, les anciens messages chiffrés ne pourront plus être déchiffrés.

### ABLY_API_KEY

Nécessaire pour le vrai temps réel : messages instantanés, présence et « écrit… ». Sans cette variable, le chat continue de fonctionner en mode de secours avec synchronisation périodique.

### RESEND_API_KEY / RESET_EMAIL_FROM

Nécessaires pour l'envoi du lien « Mot de passe oublié ». Le domaine utilisé dans `RESET_EMAIL_FROM` doit être autorisé par votre fournisseur d'e-mail.

## Déploiement conseillé

1. Conserver le dépôt GitHub actuel comme sauvegarde dans son historique.
2. Créer de préférence une branche `exam237-v5-pwa` pour le premier test.
3. Placer **le contenu de ce dossier à la racine du dépôt**.
4. Ne pas remettre les anciennes routes `api/activation/redeem.js` et `api/admin/keys.js`.
5. Ajouter les variables ci-dessus dans Vercel.
6. Laisser Vercel créer un déploiement Preview.
7. Tester : inscription → activation admin → contenus 3e → chat → création d'un nouveau groupe/classe → suppression d'un compte test.
8. Une fois validé, fusionner vers la branche de production.

## Stockage

- **Neon** : comptes, classes, groupes, messages chiffrés et métadonnées.
- **Vercel Blob** : sujets et corrections PDF.
- **Ably** : transport temps réel uniquement. Le contenu des messages n'est pas envoyé en clair : l'événement temps réel sert à signaler qu'un nouveau message doit être relu depuis l'API Exam237.
- Vidéos : conserver des liens vidéo externes plutôt que stocker de gros fichiers vidéo dans Blob.

## Routes serveur

La V5 reste volontairement compacte pour limiter le nombre de fonctions Vercel :

- `/api/auth` : connexion, inscription, déconnexion, profil, mot de passe oublié.
- `/api/data` : classes, groupes, sujets, élèves et opérations administrateur.
- `/api/chat` : messages, modération et jeton temps réel.
- `/api/files` : import et lecture protégée des PDF.

## Sécurité importante

- Les autorisations de classe sont contrôlées côté serveur, pas seulement dans l'interface.
- Un élève ne peut pas ouvrir un PDF d'un autre groupe en modifiant l'URL.
- Les cookies de session sont HTTP-only.
- Les messages sont chiffrés avant stockage.
- Comme l'administrateur doit pouvoir modérer tous les groupes, le chiffrement n'est pas du chiffrement de bout en bout au sens de WhatsApp : le serveur Exam237 autorisé peut déchiffrer pour l'affichage et la modération.
