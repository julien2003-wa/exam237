# Exam237

Plateforme d'annales camerounaises : sujets BEPC, Probatoire et Baccalauréat avec corrections vidéo.

## Ce qui est déjà fonctionnel
- inscription et connexion avec la base Neon existante de JulienLab
- compatibilité avec les mots de passe `scrypt` existants
- sessions sécurisées en cookie HttpOnly
- profil élève + classe
- abonnement annuel uniquement
- achat via bouton WhatsApp configurable
- activation d'une clé annuelle liée à l'email
- clés à 160 bits d'entropie ; seule leur empreinte SHA-256 est stockée
- catalogue premium avec sujets et corrections vidéo
- administration : générer une clé, créer une matière, ajouter un sujet, ajouter une correction, publier/brouillon

## Variables Vercel
Copier `.env.example` dans les variables d'environnement Vercel :
- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `PUBLIC_WHATSAPP_NUMBER`
- `ANNUAL_PRICE_FCFA` (facultatif au départ)
- `APP_URL`

## Base de données
Le fichier `schema_exam237.sql` ajoute uniquement les tables `ex237_*`. Il ne supprime ni ne modifie les comptes JulienLab existants.

## Flux d'administration
1. `/admin.html`
2. générer une clé annuelle pour l'email ayant payé via WhatsApp
3. créer les matières
4. ajouter les sujets en brouillon
5. ajouter éventuellement une ou plusieurs corrections vidéo
6. publier le sujet et la correction

## Flux élève
1. créer un compte ou se connecter
2. acheter l'abonnement sur WhatsApp
3. recevoir une clé annuelle
4. activer la clé depuis le tableau de bord
5. ouvrir les sujets et les corrections pendant 365 jours

## Test de santé après déploiement
Ouvrir `/api/health`. Une installation correcte renvoie `ok: true` et `database: connected`.


## Interface V2

Design mobile-first modernisé : accueil, authentification, espace élève et administration.
