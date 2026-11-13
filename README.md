# Exam237 V6 — Gratuit + Premium

Application **Next.js 15 + React 19 + TypeScript**, pensée d’abord pour le téléphone (installable comme une application), hébergée sur **Vercel** avec la base **Neon**.

## Le modèle

- **Inscription gratuite, compte actif tout de suite.** Plus d’attente d’activation.
- **Version gratuite** : le chat de la classe, **un sujet corrigé par matière** (celui que l’admin marque « Gratuit » ; sinon le sujet corrigé le plus récent de la matière est offert automatiquement), favoris et progression.
- **Premium** : tous les sujets et corrections, vidéos, Prof IA privé (même avec une photo d’exercice), lecture sans connexion, mode examen avec correction, sans publicité partenaire.
- **Passer Premium** : le bouton ouvre le WhatsApp d’Exam237 avec un message déjà rempli (nom, e-mail, classe, formule 1/3/6/12 mois et prix). L’élève paie par MTN MoMo ou Orange Money, hors du site. L’admin active le Premium dans **Admin → Élèves** (les jours s’ajoutent à ceux qui restent).
- Le verrouillage est fait **côté serveur** : un compte gratuit ne reçoit même pas l’adresse des PDF Premium, et `/api/files` répond 402 s’il essaie quand même.

## Ce que voit l’élève

- **Accueil** : statuts vidéo (promos), formule en cours, compte à rebours de l’examen, « Reprendre », progression par matière, favoris, derniers sujets.
- **Sujets** : recherche, filtres (favoris, à revoir, faits, gratuits), matières par couleur, années, badge « Nouveau ».
- **Fiche d’un sujet** : sujet, corrections (avec le nom du relecteur), vidéo, mode examen chronométré, lecture sans connexion, favori / fait / à revoir, partage WhatsApp, « Signaler une erreur ».
- **Chat de la classe** (style WhatsApp) : envoi instantané (le message s’affiche avant même la réponse du serveur), réponses citées, réactions, « … écrit », messages épinglés, appui long pour sélectionner, glisser pour répondre. Numéros de téléphone, e-mails et liens WhatsApp masqués, insultes filtrées.
- **Prof IA** (Premium) : conversation privée, photo d’exercice réduite dans le téléphone avant l’envoi, indices d’abord puis solution si l’élève la demande.
- **Profil** : nom, mot de passe, téléchargements hors ligne, installation de l’application, aide WhatsApp, suppression du compte.
- Page publique **/bienvenue** (présentation, gratuit vs Premium), page hors ligne, pages d’erreur.

## Administration (compte admin)

| Onglet               | Contenu                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tableau de bord      | Chiffres clés, Premium qui se terminent dans 7 jours (+1 mois en un geste), sujets les plus lus, configuration à faire, export CSV des élèves                                                                          |
| Élèves               | Recherche, filtres (gratuits, Premium, finissent bientôt, suspendus), activer / prolonger / retirer le Premium, changer de classe, lien de nouveau mot de passe à envoyer par WhatsApp, suspendre, supprimer           |
| Sujets & corrections | Publier un sujet (+ correction), durée de l’épreuve, sujet gratuit, relecteur, remplacer un PDF                                                                                                                        |
| Vidéos promo         | Statuts de l’accueil : fichier vidéo (60 Mo max) ou lien YouTube, bouton (Premium, WhatsApp, lien), public, groupe, dates, ordre, vues et clics. Les vidéos **Partenaire** ne sont jamais montrées aux membres Premium |
| Classes & groupes    | Groupes (avec leur chat), classes, type d’examen                                                                                                                                                                       |
| Signalements         | Messages du chat signalés et erreurs signalées dans les sujets                                                                                                                                                         |
| Assistant IA         | Mode du chat, questions par jour (Premium / gratuits), test, journal                                                                                                                                                   |
| Réglages             | Numéro WhatsApp, prix des formules, dates des examens, mots interdits                                                                                                                                                  |

Le numéro WhatsApp et les prix sont enregistrés **dans la base**, jamais dans le code (le dépôt est public).

## Variables Vercel

```text
DATABASE_URL=...                 # Neon
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
APP_URL=https://exam237.vercel.app
BLOB_READ_WRITE_TOKEN=...        # Vercel Blob (PDF et vidéos, en privé)
CHAT_MASTER_KEY=...              # 32 caractères aléatoires minimum, ne jamais la changer
ABLY_API_KEY=...                 # chat instantané (sinon mise à jour toutes les 4 s)
ANTHROPIC_API_KEY=...            # Prof IA et assistant du chat (facultatif)
ANTHROPIC_MODEL=                 # facultatif, claude-haiku-5-5 par défaut
ASSISTANT_EFFORT=                # facultatif : low, medium ou high
ANTHROPIC_WORKSPACE_ID=          # seulement si la clé n’est rattachée à aucun workspace
```

`RESEND_API_KEY` et `RESET_EMAIL_FROM` ne servent plus : le mot de passe oublié passe par WhatsApp (l’admin crée le lien dans **Élèves → Plus…**).

**CHAT_MASTER_KEY** : ne jamais la mettre dans GitHub ni la changer après le lancement, sinon les anciens messages ne peuvent plus être déchiffrés.

## Base de données

La V6 réutilise toutes les tables existantes et ajoute elle-même, au premier usage, ce qui lui manque (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) :

- colonnes `ex237_corrections.reviewer_name` et `ex237_papers.duration_minutes` ;
- tables `ex237_settings`, `ex237_user_papers`, `ex237_content_views`, `ex237_login_attempts`, `ex237_content_reports`, `ex237_tutor_messages`, `ex237_chat_reactions`, `ex237_premium_log`, `ex237_promos`, `ex237_promo_events`.

Rien n’est supprimé : l’ancienne version peut tourner sur la même base pendant les tests. Une seule fois, tous les sujets passent en Premium (`is_premium = TRUE`) ; l’admin choisit ensuite ses sujets gratuits.

## Déploiement

1. Travailler sur la branche `v6-premium` : Vercel crée un déploiement **Preview** sans toucher au site de production.
2. Tester sur la Preview : inscription → compte gratuit → « Passer Premium » → activation dans l’admin → sujets débloqués → chat → Prof IA → vidéo promo.
3. Une fois validé, fusionner `v6-premium` dans `main`.

## Sécurité

- Autorisations vérifiées côté serveur (classe, groupe, Premium, admin).
- Cookies de session HTTP-only ; blocage après 5 mots de passe faux en 15 minutes ; limite d’inscriptions par réseau.
- Messages du chat et du Prof IA chiffrés (AES-256-GCM) avant stockage. En temps réel, le texte des messages passe par Ably chiffré avec une clé propre au salon ; seules des informations techniques (réactions, « … écrit ») y passent en clair.
- Ce n’est pas du chiffrement de bout en bout : le serveur d’Exam237 peut déchiffrer pour l’affichage et la modération (les élèves sont mineurs).
- Les élèves étant mineurs, les réponses de l’IA sont signalées « IA · peut se tromper », modérées et visibles par l’admin. Voir [les recommandations d’Anthropic pour les services qui accueillent des mineurs](https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors).

## Routes serveur

- `/api/auth` : connexion, inscription, déconnexion, nouveau mot de passe.
- `/api/me` : espace de l’élève (progression, profil, mot de passe, suppression du compte, signalements, Prof IA).
- `/api/data` : démarrage de l’application, données publiques, administration.
- `/api/chat` : messages, réactions, épingles, modération, assistant, jeton temps réel.
- `/api/files` : lecture protégée des PDF et vidéos, envoi direct vers Vercel Blob.

## Hébergement

Le plan Vercel **Hobby** est réservé à un usage non commercial. Dès que le Premium est vendu (ou que des publicités partenaires sont diffusées), passer au plan **Pro**.
