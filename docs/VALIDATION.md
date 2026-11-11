# Rapport de validation — 11 novembre 2026

Les vérifications ci-dessous ont été exécutées sur le code livré. Elles décrivent la couverture réelle et ne constituent pas une certification de sécurité ou de charge.

## Contrôles automatisés

| Contrôle | Résultat et périmètre |
| --- | --- |
| TypeScript frontend et backend | `npm run check` réussi en environnement Windows et Linux |
| Compilation de production | Client Prisma, backend Node et frontend Vite compilés sans erreur |
| Tests Node | Huit tests, comprenant des parcours API avec bases temporaires, sécurité, licences, clients, édition hiérarchique, indication des dossiers électriques, recherche du patrimoine et récupération |
| API | Installation initiale et refus de reconfiguration, authentification, CSRF et origine, hiérarchie complète, parents invalides, métadonnées, associations d’équipements, imports, versions, restauration et téléchargement |
| Droits | Lecteur limité à un site ; refus de lecture d’un autre site et de son QR code ; refus d’écriture et d’administration ; révocation des sessions |
| Documents | Fichier avec signature invalide refusé ; PNG importé et téléchargé à l’identique ; PDF textuel généré, extrait et trouvé par son préfixe dans FTS5 ; import DWG/DXF par signatures ; révision dupliquée refusée |
| Filtres | Texte, tag exact, statut, date ; date calendrier invalide refusée |
| Sauvegardes | Instantané, restauration de la fiche et des fichiers, déconnexion des sessions, manifeste altéré refusé sans toucher à la base active |
| Récupération | Verrou CLI/service et simulation d’une restauration interrompue avec récupération au prochain démarrage |
| Cryptographie | Mots de passe salés et vérification ; signature Ed25519 valide, falsifiée, expirée et destinée à une autre installation |
| Navigateur Chromium | Première configuration, connexion, création de site, QR, fiche, import, aperçu, téléchargement, édition, recherche, thème sombre et affichage mobile 390 px ; aucune erreur JavaScript observée |
| Lecteur PDF/images | Second parcours navigateur : dossiers imbriqués, PDF de deux pages rendu sur canvas avec pixels contrôlés, changement de page, zoom, rotation, sélection de révision image, navigation vers un autre fichier, panneau gauche/droite et lecture mobile. Toute requête hors de l’origine locale est bloquée durant ce test. |
| Clients et références | Préfixes normalisés et uniques, rattachements modifiables à chaque niveau, héritage et absence de client explicite, créations simultanées sans doublon, préfixe éditable sans réécriture des anciens documents, réservation permanente des références, réaffectation et renouvellement avec historique, client désactivé et filtrage selon les sites autorisés. |
| Édition du patrimoine | Nom, référence, description, type, parent et client éditables ; refus des cycles et associations invalides ; déplacement d’un sous-arbre et de ses documents entre sites, et refus d’un déplacement qui séparerait un document d’un équipement. Vérifications API et parcours navigateur de changement du client d’un bâtiment après création. |
| Recherche du patrimoine | Recherche multi-mots sans accents, référence, description, client, filtre par type, parents conservés, aucun résultat et réinitialisation ; vérifications unitaires et navigateur. |
| Provisoire / Définitif | Enregistrement et validation API sur le client et le bâtiment ; refus des valeurs invalides ; héritage du client, priorité des dossiers parents, modification et retour à l’héritage ; absence d’indication laissée sans classification. Parcours navigateur avec client provisoire et bâtiment définitif, puis vérification du badge sur la fiche du plan électrique. |
| Dépendances | `npm audit --audit-level=moderate` : aucune vulnérabilité connue signalée au moment du contrôle |

Les tests navigateur produisent `artifacts/electroplan-desktop.png` et `artifacts/electroplan-mobile.png`. Les données de test ne sont pas initialisées dans une installation de production.

## Linux et paquet natif

- Paquet amd64 construit avec `dpkg-deb`, runtime Node 22 et moteurs Prisma Linux inclus.
- Installation et réinstallation réelles sous Debian 12 dans l’environnement de vérification ; configuration conservée et migrations idempotentes.
- Permissions du répertoire de données et du fichier de configuration contrôlées ; sauvegarde par le compte système non privilégié.
- Unité contrôlée par `systemd-analyze verify`.
- Exécution GitHub Actions sur Ubuntu 24.04 avec **systemd réel** : installation, démarrage du service, réponse `/api/health`, arrêt, sauvegarde et réinstallation réussis. [Exécution de référence](https://github.com/lfi2022/Elecplan/actions/runs/43005324010).
- Le script de vérification inclut également le démarrage direct du programme installé et le chargement du frontend quand systemd n’est pas PID 1. L’environnement Docker de vérification coupe le réseau pendant cette phase.
- Un parcours supplémentaire sur le programme installé vérifie, réseau coupé, la première configuration, la connexion, le patrimoine, l’import et la recherche d’un PDF, puis une sauvegarde et sa restauration. Le processus applicatif s’exécute sous le compte `electroplan`.
- Migration clients exécutée sur la base locale existante après sauvegarde : comparaison avant/après des identifiants et références documentaires, clés et empreintes des fichiers et entrées de l’index PDF, sans modification de ces données.

La première exécution CI a mis en évidence une interrogation du port avant sa disponibilité. Le test attend maintenant la santé HTTP avec un délai borné avant de continuer.

## Limites explicites

- Pas d’OCR ni de rendu DWG/DXF demandé/livré : ces formats CAO sont stockés et téléchargés ; les aperçus concernent PDF et images. Aucun corpus de fichiers métier réels n’a été fourni pour une validation CAO étendue.
- Extraction PDF limitée en pages, taille de texte, délai et mémoire V8 du processus séparé. Les PDF chiffrés ou trop complexes peuvent être refusés.
- Le stockage est local et mono-service. La charge à grande échelle, les volumes réseau, la haute disponibilité et les architectures ARM ne sont pas validés.
- TLS doit être configuré sur le réseau cible ; le fichier Nginx fourni n’a pas été déployé avec un certificat d’entreprise réel.
- La récupération après interruption est simulée ; aucune panne électrique physique ni corruption matérielle n’a été provoquée.
- Les sauvegardes sont locales et sans rétention automatique. La copie hors serveur et les tests périodiques de restauration restent des opérations d’exploitation.
- Les deux éditions partagent actuellement le périmètre fonctionnel. Le mécanisme de licence est effectif ; une politique de quotas ou une différenciation commerciale devra être définie par le distributeur si souhaitée.
- Aucun audit externe, test d’intrusion exhaustif ou benchmark de charge n’est revendiqué.

Toutes les fonctions visibles sont reliées à des routes et à des données persistées, à l’exception du thème qui est une préférence locale du navigateur. Les réglages réseau se font dans le fichier d’environnement documenté, pas par un formulaire inactif.
