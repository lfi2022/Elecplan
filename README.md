# ElectroPlan

Gestion autonome des plans électriques et du patrimoine technique, en français. React/TypeScript/Vite/Tailwind, API Fastify, SQLite/Prisma, fichiers locaux. Le serveur sert le frontend compilé ; aucun CDN, service cloud, compte externe ou accès Internet n’est nécessaire en exploitation.

## Fonctions livrées

- Tableau de bord calculé depuis les données accessibles : documents, sites/bâtiments, locaux, équipements et activité.
- Arborescence sites → bâtiments → étages → zones → locaux → tableaux → équipements ; certains niveaux intermédiaires sont facultatifs, avec contrôle des parents côté serveur.
- Fiches documentaires, métadonnées, catégories libres, tags, date, statut, référence, équipements associés. Domaines Électricité, HVAC, Plomberie, Incendie et Réseaux informatiques.
- Import PDF, PNG/JPEG, DWG/DXF ; téléchargement contrôlé et aperçu PDF/images. Stockage par UUID, empreinte SHA-256, limite de 50 Mo par fichier.
- Lecteur PDF/images intégré : dossiers hiérarchiques à gauche ou à droite, document au centre, navigation entre fichiers et révisions, pages PDF, zoom, rotation et ajustement à la largeur. PDF.js et ses ressources sont servis localement, sans lecteur externe ni CDN.
- Révisions immuables, auteur/date, historique et sélection/restauration de la version en vigueur.
- Recherche multicritère et texte des PDF indexé dans SQLite FTS5 : mots/préfixes, accents normalisés. La recherche porte sur toutes les révisions conservées. Extraction limitée aux 1 000 premières pages et à 2 millions de caractères ; pas d’OCR des scans.
- QR codes PNG des fiches du patrimoine. Les liens exigent la connexion au réseau et les droits d’accès habituels.
- Comptes administrateur, éditeur, lecteur, permissions supplémentaires granulaires et liste explicite des sites autorisés.
- Clients : coordonnées, code, préfixe documentaire et rattachement des sites ; références séquentielles générées automatiquement à la création, par exemple `ACME-ELEC-00001`.
- Recherche du patrimoine par nom, référence, description, client et type, sans sensibilité aux accents ; les parents des résultats restent visibles dans l’arborescence.
- Audit des connexions et opérations ; administration serveur, organisation, stockage, sauvegardes cohérentes et restauration.
- Activation locale de licences Ed25519 liées à l’installation, avec édition, client et expiration vérifiés côté serveur.

L’édition Standard fonctionne sans licence. Professionnel est activable par fichier signé. Les fonctions décrites ci-dessus sont disponibles dans les deux éditions : cette version ne fixe pas de quotas commerciaux ni de restrictions payantes artificielles. La vérification et le point de décision d’édition sont centralisés dans `server/license.ts` et `licenseState()`.

## Installation native recommandée

Pour ouvrir le lecteur, choisir **Documents → Lecteur de plans**, ou **Prévisualiser** depuis une fiche. Déplier les dossiers du patrimoine puis sélectionner un fichier. **Dossiers à droite/gauche** déplace l’arborescence ; sa position est mémorisée dans le navigateur. Sur mobile, le panneau peut être masqué pour conserver toute la largeur de lecture. Le filtre du panneau porte sur les fichiers déjà chargés ; la recherche globale reste disponible dans la bibliothèque.

Plateformes ciblées : **Debian 12/13 ou Ubuntu 24.04+, amd64**, systemd. Le paquet contient Node.js 22, le code compilé, les dépendances et les moteurs Prisma Linux. Il ne télécharge aucun module à l’installation. Les bibliothèques système déclarées dans le paquet doivent déjà être présentes, ou accessibles dans votre dépôt APT local.

Récupérer le `.deb` et son SHA-256 dans les artefacts du workflow GitHub Actions, ou les produire avec les instructions de compilation ci-dessous.

```bash
sha256sum -c electroplan_1.0.0_amd64.deb.sha256
sudo apt install ./electroplan_1.0.0_amd64.deb
sudoedit /etc/electroplan/electroplan.env
```

Exemple pour un LAN sans reverse proxy :

```dotenv
DATA_DIR=/var/lib/electroplan
DATABASE_URL=file:/var/lib/electroplan/electroplan.db
HOST=0.0.0.0
PORT=3000
PUBLIC_URL=http://192.168.1.20:3000
COOKIE_SECURE=false
SETUP_TOKEN=<conserver-le-secret-aleatoire-genere-par-le-paquet>
LICENSE_PUBLIC_KEY_FILE=/etc/electroplan/license-public.pem
```

```bash
sudo systemctl restart electroplan
sudo systemctl status electroplan --no-pager
sudo grep '^SETUP_TOKEN=' /etc/electroplan/electroplan.env
```

Ouvrir l’URL publique, saisir le jeton et créer l’administrateur (mot de passe : 12 à 128 caractères). Le jeton ne peut plus servir après la création du premier compte. Aucun compte ni mot de passe par défaut. Les utilisateurs suivants sont créés dans **Utilisateurs**. Un compte non administrateur sans site attribué ne voit aucun patrimoine.

Le paquet écoute initialement sur `127.0.0.1:3000`. Pour un premier accès distant sans ouvrir le port : `ssh -L 3000:127.0.0.1:3000 utilisateur@serveur`, puis `http://localhost:3000`. Configurer ensuite l’adresse définitive pour les QR codes et la vérification d’origine.

### HTTPS et reverse proxy

Sur un réseau partagé, terminer TLS sur un reverse proxy local et régler `PUBLIC_URL=https://plans.exemple.local`, `HOST=127.0.0.1`, `COOKIE_SECURE=true`. Le proxy doit autoriser 50 Mo plus l’enveloppe multipart et conserver le chemin `/api`. Exemple Nginx dans [docs/nginx.conf](docs/nginx.conf). Aucun en-tête de proxy n’est considéré fiable par l’application ; la limitation des tentatives se fait donc par IP du proxy dans cette configuration. Appliquer également une limitation de débit sur le proxy si plusieurs clients le partagent.

Les cookies sont HttpOnly/SameSite=Strict, valables huit heures. Les mutations authentifiées exigent le jeton `X-CSRF-Token`, et l’origine fournie doit correspondre à `PUBLIC_URL`. Les formulaires de création et de connexion acceptent du JSON uniquement.

### Emplacements et permissions

| Emplacement | Contenu | Propriétaire |
| --- | --- | --- |
| `/opt/electroplan` | Application et runtime, lecture seule pour le service | root |
| `/etc/electroplan/electroplan.env` | Configuration, mode 0640 | root:electroplan |
| `/var/lib/electroplan/electroplan.db` | Base SQLite | electroplan |
| `/var/lib/electroplan/files` | Fichiers nommés par UUID | electroplan |
| `/var/lib/electroplan/backups` | Instantanés et manifestes SHA-256 | electroplan |

Le service tourne sous le compte système non privilégié `electroplan`, avec umask 0077, protection du système de fichiers et redémarrage sur échec. Un seul processus utilise une installation. Le verrou est partagé avec les commandes CLI et les migrations.

## Exploitation

### Clients et références documentaires

1. Un administrateur crée le client dans **Clients**, avec un code (`ACME`) et un préfixe unique (`ACME-ELEC`).
2. Dans **Patrimoine → Modifier**, rattacher un site, un bâtiment ou tout autre élément à ce client. Choisir **Hériter du parent** pour reprendre le client du parent le plus proche, ou **Sans client** pour interrompre cet héritage.
3. Lorsqu’un document est créé, le choix **Utiliser le client de la localisation** applique ce rattachement. Un client peut également être choisi explicitement sur la fiche. La référence est attribuée côté serveur : `ACME-ELEC-00001`, `ACME-ELEC-00002`, etc. Le compteur est commun aux éléments du même client et fait partie des sauvegardes.

Le compteur, la réservation de référence et la création de la fiche sont enregistrés dans une même transaction SQLite. Les références déjà attribuées sont réservées même après suppression d’un document. Le préfixe du client et le rattachement d’un site ou bâtiment peuvent être modifiés après création ; les anciennes références ne sont jamais réécrites par ces modifications.

La fiche documentaire permet de changer de client ou de cocher **Attribuer une nouvelle référence**. Une nouvelle référence est alors générée, et l’ancienne est conservée avec l’ancien client, la date et l’auteur dans **Historique des références**. Les fichiers et leurs révisions restent associés à la même fiche. La recherche textuelle retrouve aussi les anciennes références.

L’édition du patrimoine expose le nom, la référence, la description, le type, le parent et le client. Les déplacements entre sites sont réservés aux administrateurs et mettent à jour le site des descendants et de leurs documents dans une transaction. Les cycles, types incompatibles avec les enfants et déplacements séparant un document de ses équipements sont refusés. La transformation d’un site en élément d’un autre site retire les anciennes autorisations de ce site ; aucune autorisation sur le site cible n’est accordée implicitement.

Les documents antérieurs conservent exactement leurs références et restent des références historiques, sans modification automatique lors du rattachement du site. Les sites sans client continuent à utiliser une référence libre, requise et contrôlée contre les doublons à la création. La désactivation d’un client conserve ses données et interdit les nouvelles fiches sur ses sites ; les documents existants restent consultables et modifiables.

La gestion des clients et des rattachements dans le patrimoine est réservée aux administrateurs. Les autres utilisateurs voient uniquement les identifiants et préfixes des clients rattachés à des éléments ou documents de leurs sites autorisés, sans coordonnées privées ni compteurs globaux. Un éditeur peut réaffecter un document aux clients auxquels il a accès. Les droits de lecture restent déterminés par le site.

Dans **Patrimoine**, saisir plusieurs mots dans **Rechercher dans le patrimoine**, puis éventuellement choisir un type d’élément. La recherche porte uniquement sur les éléments accessibles à l’utilisateur ; les branches parentes restent visibles pour situer chaque résultat.

```bash
sudo systemctl start electroplan
sudo systemctl stop electroplan
sudo systemctl restart electroplan
sudo systemctl enable electroplan
sudo journalctl -u electroplan -n 100 --no-pager
sudo journalctl -u electroplan -f
curl --fail http://127.0.0.1:3000/api/health
```

### Sauvegarde

Dans **Administration → Sauvegardes**, créer un instantané à chaud. Pendant les opérations de base et de fichiers, les requêtes API sont coordonnées pour empêcher les écritures concurrentes avec l’instantané. `VACUUM INTO` crée une base autonome cohérente ; les fichiers immuables et leurs sommes de contrôle l’accompagnent.

Pour une sauvegarde CLI, arrêter le service. La commande refuse de s’exécuter si le processus de service détient le verrou :

```bash
sudo systemctl stop electroplan
sudo -u electroplan /bin/sh -c 'set -a; . /etc/electroplan/electroplan.env; set +a; cd /opt/electroplan; runtime/bin/node dist/server/cli.js backup'
sudo systemctl start electroplan
```

La sortie contient l’UUID de sauvegarde. Copier **tout** le répertoire `/var/lib/electroplan/backups/UUID/` vers un support distinct, ainsi que `/etc/electroplan/` et la version du paquet installée. Les sauvegardes contiennent les comptes et les documents ; protéger le support avec les mêmes droits et, si nécessaire, le chiffrement du système de stockage. Aucune rétention automatique : surveiller le disque et conserver plusieurs générations hors serveur.

```bash
sudo tar -C /var/lib/electroplan/backups -czf /media/sauvegarde/electroplan-UUID.tar.gz UUID
sudo tar -C /etc -czf /media/sauvegarde/electroplan-config.tar.gz electroplan
```

### Restauration

L’interface restaure une sauvegarde locale après saisie de `RESTAURER`, crée d’abord une sauvegarde de sécurité puis ferme toutes les sessions. Les manifestes et l’intégrité SQLite sont vérifiés avant remplacement. Le schéma doit correspondre exactement aux migrations du logiciel installé.

Pour une sauvegarde provenant d’un autre serveur, installer la même version du paquet, arrêter le service, extraire votre archive de confiance dans `/var/lib/electroplan/backups`, puis :

```bash
sudo systemctl stop electroplan
sudo chown -R electroplan:electroplan /var/lib/electroplan/backups/UUID
sudo -u electroplan /bin/sh -c 'set -a; . /etc/electroplan/electroplan.env; set +a; cd /opt/electroplan; runtime/bin/node dist/server/cli.js restore UUID --confirm'
sudo systemctl start electroplan
```

Remplacer `UUID` par l’identifiant réel. Les fichiers ne sont jamais extraits depuis une archive téléversée par l’application. Une copie `rollback-UUID` reste sur le serveur après restauration ; la conserver jusqu’à vérification, puis l’archiver/supprimer manuellement. Un marqueur de restauration permet de revenir à cette copie avant ouverture de la base si le processus a été interrompu. Cette récupération est testée par simulation ; la résistance à une panne physique dépend aussi de la fiabilité et des garanties d’écriture du système de fichiers.

### Mise à jour

```bash
# Conserver auparavant le paquet de la version en cours et une copie de /etc/electroplan.
sudo apt install ./electroplan_VERSION_amd64.deb
sudo systemctl status electroplan --no-pager
sudo journalctl -u electroplan -n 80 --no-pager
```

Le service est arrêté avant remplacement du code, les données existantes sont sauvegardées, puis les migrations sont appliquées sans remise à zéro. La configuration existante est conservée. Si la migration échoue, ne pas réinitialiser la base : lire le journal, conserver la sauvegarde, réinstaller la version correspondante et restaurer son instantané. Le retour à une ancienne version nécessite sa sauvegarde de schéma ; les migrations descendantes automatiques ne sont pas implémentées.

La désinstallation, y compris purge du paquet, conserve volontairement les données, la configuration et le compte système. Leur suppression définitive relève d’une opération administrateur distincte.

## Développement et compilation

Node.js **22.22+ dans la branche 22**, npm 10+, Git. Sur Windows, PowerShell : utiliser `npm.cmd` si la politique d’exécution bloque `npm.ps1`.

```bash
git clone https://github.com/lfi2022/Elecplan.git
cd Elecplan
npm ci
cp .env.example .env
# Remplacer SETUP_TOKEN par un secret aléatoire d’au moins 24 caractères.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run migrate
npm run build
npm start
```

Développement avec rechargement : `npm run dev` et, dans un second terminal, `npm run dev:web`. Ouvrir `http://localhost:5173` et régler `PUBLIC_URL=http://localhost:5173` dans `.env` pour les mutations via le proxy Vite. Les scripts chargent `.env`, les valeurs de l’environnement système ont priorité. Sans `DATABASE_URL`, la base est créée dans `DATA_DIR`. Les chemins `file:` relatifs sont résolus depuis `prisma/`.

```bash
npm run check
npm test
npx playwright install chromium
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

Les tests utilisent des bases temporaires indépendantes. Le test navigateur produit des captures dans `artifacts/`. Consulter [docs/VALIDATION.md](docs/VALIDATION.md) pour le périmètre effectivement vérifié.

### Construire le paquet Debian

Sur Debian 12/Ubuntu 24.04 amd64 avec Node 22 et npm déjà installés :

```bash
sudo apt install build-essential dpkg-dev ca-certificates
bash scripts/build-deb.sh
# Résultat : artifacts/electroplan_1.0.0_amd64.deb et son .sha256
```

La construction nécessite Internet pour `npm ci`. L’installation du paquet fini n’en nécessite pas. Le paquet embarque actuellement l’arbre de dépendances verrouillé complet, y compris Prisma CLI pour les migrations. Cela privilégie la reproductibilité à la taille du paquet.

Un environnement de vérification facultatif est fourni ; Docker est utilisé uniquement pour construire/tester :

```bash
docker build -f packaging/Dockerfile.verify -t electroplan-verify .
mkdir -p artifacts
docker run --rm -v "$(pwd)/artifacts:/out" electroplan-verify
```

Sur une VM jetable avec systemd, vérifier installation et réinstallation avec `sudo bash scripts/linux-smoke.sh artifacts/electroplan_1.0.0_amd64.deb`. Le workflow GitHub Actions exécute également les tests, construit et conserve le paquet en artefact.

## Licences commerciales hors ligne

Le distributeur conserve sa clé privée **hors du serveur client et du dépôt** :

```bash
openssl genpkey -algorithm ED25519 -out /chemin-prive/private.pem
openssl pkey -in /chemin-prive/private.pem -pubout -out public.pem
sudo install -o root -g electroplan -m 0640 public.pem /etc/electroplan/license-public.pem
```

Récupérer l’identifiant d’installation dans Administration. Créer le payload :

```json
{"customer":"Client Exemple","edition":"Professionnel","expiresAt":null,"installationId":"UUID-DE-L-INSTALLATION"}
```

```bash
npm run license:sign -- /chemin-prive/private.pem payload.json licence.json
```

Importer `licence.json` dans Administration. Le serveur vérifie la signature sur les octets exacts du payload, la clé Ed25519, l’installation et la date d’expiration. Une licence absente/invalide/expirée revient à Standard et ne supprime jamais de données. L’horloge du serveur est la référence ; un administrateur contrôlant entièrement la machine et le code ne peut pas être empêché cryptographiquement de modifier un logiciel self-hosted.

## Architecture et API

- `server/app.ts` : routes REST `/api`, validations Zod, contrôles de permission et filtres par site.
- `server/security.ts` : mots de passe scrypt salés, sessions opaques hachées en base, rôles/permissions.
- `server/storage.ts` : validation des signatures, stockage UUID et extraction PDF dans un processus séparé (15 secondes, mémoire V8 limitée).
- `server/backup.ts`, `server/lock.ts` : instantanés, restauration, reprise et verrouillage.
- `server/license.ts` : vérification cryptographique indépendante du transport.
- `prisma/schema.prisma`, `prisma/migrations` : modèle, contraintes, historique SQL et index FTS5 maintenu par triggers.
- `web/src` : interface réactive, états persistés côté serveur, thèmes locaux clair/sombre.

Les familles d’API sont `/api/setup`, `/api/auth/*`, `/api/dashboard`, `/api/locations`, `/api/documents`, `/api/users`, `/api/audit`, `/api/admin/*`. Les routes de fichier référencent obligatoirement le document et sa version ; aucun chemin de stockage n’est accepté du client. Les codes usuels sont 400 validation, 401 session, 403 permission/CSRF, 404 inaccessible/inexistant et 409 conflit.

## Dépannage et limites d’exploitation

- **403 sur une mutation** : vérifier l’égalité exacte de l’origine du navigateur et de `PUBLIC_URL`, le protocole, le port et le cookie. Reconnecter après un changement des droits.
- **Cookie absent** : `COOKIE_SECURE=true` demande HTTPS. La configuration initiale HTTP locale utilise `false`.
- **Aucun document pour un utilisateur** : attribuer explicitement les sites dans Utilisateurs ; vérifier les filtres de recherche.
- **Un PDF est refusé** : fichier invalide/chiffré, analyse trop lourde ou limite dépassée ; fournir une version lisible. Les scans sans texte sont conservés mais ne sont pas OCRisés. DWG/DXF sont conservés et téléchargeables, sans moteur de rendu CAO ni extraction de texte CAO.
- **Service en échec** : consulter `journalctl`, vérifier les droits, le disque libre, les valeurs de l’environnement et les migrations. Les fichiers de verrou ne doivent pas être supprimés pendant qu’un processus fonctionne.
- **Espace disque** : prévoir la taille des documents, des révisions, des sauvegardes et au moins une copie de récupération. Pas de nettoyage automatique des anciennes versions ou sauvegardes.
- **Volumes importants** : l’admission API est coordonnée pour la cohérence des sauvegardes/restaurations ; une importation PDF ou une sauvegarde peut retarder d’autres appels. Cette édition mono-service SQLite cible les équipes et installations locales, sans haute disponibilité ni stockage réseau partagé.
- **Sécurité des fichiers** : liste de formats et signatures, noms internes, absence d’exécution serveur, réponses `nosniff` et contrôle des droits. Un antivirus externe n’est pas intégré. Les signatures de fichiers ne garantissent pas l’innocuité de tous les contenus CAO/PDF ; maintenir les lecteurs du poste client à jour.

Les sources de référence utilisées pour les choix d’infrastructure sont la [documentation Fastify](https://fastify.dev/docs/latest/Reference/Server/) et la [documentation Prisma SQLite](https://docs.prisma.io/docs/prisma-orm/quickstart/sqlite). Les versions exactes livrées sont verrouillées dans `package-lock.json`.
