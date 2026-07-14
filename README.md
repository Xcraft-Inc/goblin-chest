# 📘 goblin-chest

## Aperçu

Le module `goblin-chest` est un système de stockage de fichiers avancé pour l'écosystème Xcraft. Il fournit une solution complète pour gérer le cycle de vie des fichiers avec des fonctionnalités de chiffrement, compression, versionnement et aliasing. Ce module agit comme un coffre-fort sécurisé pour les fichiers, permettant leur stockage, récupération et gestion efficace dans une application Xcraft, tout en assurant une synchronisation transparente entre clients et serveur.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module s'articule autour de cinq acteurs Elf principaux :

1. **Chest** (`Elf.Alone`) - L'acteur principal singleton qui orchestre le stockage et la récupération des fichiers, ainsi que la synchronisation client-serveur.
2. **ChestObject** (`Elf.Archetype`) - Représente un fichier individuel stocké dans le coffre avec ses métadonnées.
3. **ChestAlias** (`Elf.Archetype`) - Permet de créer des références nommées vers des ChestObjects dans des espaces de noms spécifiques.
4. **Gold** (`Elf.Archetype`) - Gère des fichiers avec un cycle de vie simplifié, un alias automatique et une intégration Git optionnelle.
5. **GoldWarden** (`Elf.Alone`) - Surveille un répertoire du système de fichiers (ou un dépôt Git distant) pour synchroniser automatiquement les acteurs Gold.

Autour de ces acteurs gravitent plusieurs briques utilitaires :

- **`GoldFs`** - Une interface façon `fs` (readdir, readFile, writeJSON, etc.) construite au-dessus des acteurs Gold.
- **`backend/fs.js` (SHFS)** - Le backend de stockage physique par défaut, basé sur un système de fichiers adressé par hash SHA-256.
- **`git/git.js` (Git)** - Un wrapper minimaliste autour du binaire `git`, utilisé par le `GoldWarden` pour synchroniser un dépôt distant.

Le module utilise un système de backend configurable pour le stockage physique des fichiers (`chestConfig.backend`, `fs` par défaut).

## Fonctionnement global

### Stockage et récupération

Lorsqu'un fichier est fourni au coffre via la méthode `supply` :

1. Le fichier est temporairement écrit via un stream d'écriture obtenu du backend.
2. Le mime type et le charset sont détectés à partir du fichier temporaire.
3. Le backend calcule le hash SHA-256 du contenu (après chiffrement/compression éventuels) et déplace le fichier vers son emplacement définitif (répertoire nommé d'après les 2 premiers caractères du hash).
4. Un `ChestObject` est créé puis mis à jour (`upsert`) dans la base Cryo avec incrémentation de génération.
5. Optionnellement, un `ChestAlias` est créé pour référencer ce fichier via un namespace convivial.

La récupération se fait via `retrieve`, qui vérifie l'existence physique du fichier, lit son état Cryo pour connaître son éventuel chiffrement, puis retourne un stream Xcraft prêt à être consommé.

### Cycle de vie et nettoyage

- Les fichiers peuvent être marqués `trashed` (mise à la corbeille logique) ou `unlinked` (l'entrée en base subsiste mais le fichier physique n'est plus garanti).
- `Chest._collect()` parcourt les fichiers présents dans le backend et supprime ceux dont l'état Cryo est `trashed` ou dont le lien est `unlinked`.
- `Chest._collectOrphans()` analyse l'ensemble des bases Cryo répliquées (hors la base `chest` elle-même) afin de repérer les `chestObject@...` qui ne sont plus référencés nulle part (ni par une autre entité applicative, ni par un `ChestAlias`), puis les met à la corbeille en respectant une taille cumulée maximale configurable (`collect.orphans.maxSize`).
- Un système de génération (`generation`) permet de conserver un historique ordonné des versions successives d'un même nom de fichier.

### Mode réplica et rôle client/serveur

L'acteur `Chest` détermine son rôle (`_isClient`) à partir de la configuration `xcraft-core-goblin` (`actionsSync.enable`).

- **Côté client**, `Chest` souscrit à l'événement `*::chest.missing-file-needed` : si le client possède le fichier demandé dans son propre backend, il le fournit au serveur via un appel RPC (`supply`).
- **Côté serveur, ou en mode réplica** (`options.replica`), `setReplica(true)` est invoqué : les tâches périodiques Chronomancer de vérification des manquants et de collecte sont démarrées, et la taille maximale du backend est levée (mode réplica = pas de limite de taille).
- `setReplica(false)` réapplique la limite de taille configurée et arrête les tâches Chronomancer associées.

### Vérification des fichiers manquants

`_checkForMissing()` (tâche planifiée) parcourt les `ChestObject` non `unlinked` :

- **Côté client**, elle tente `locationTry` pour chaque objet ; si le serveur est injoignable, elle interrompt le cycle de vérification.
- **Côté serveur**, elle vérifie l'existence physique dans le backend et, si le fichier est absent, diffuse un événement `missing-file-needed` à tous les clients connectés (`_xcraftRPC: true`).

`locationTry` implémente une boucle de nouvelle tentative (jusqu'à 60 essais espacés d'une seconde) côté serveur en l'absence du fichier, avant d'abandonner avec une erreur explicite.

### Chiffrement et compression

Le module offre des capacités de sécurité avancées, implémentées dans le backend `fs` (`SHFS`) :

- Chiffrement symétrique (AES-256-CBC par défaut) avec une clé générée aléatoirement pour chaque fichier.
- Compression GZIP optionnelle appliquée avant chiffrement.
- La clé symétrique et l'IV sont eux-mêmes chiffrés avec une clé publique RSA (`OAEP padding`) fournie lors de l'appel à `supply`, et stockés en base64 dans l'état Cryo (`EncryptionShape.key`).
- Le déchiffrement (`retrieve`) nécessite la clé privée correspondante.

### Synchronisation client-serveur

Un mécanisme intelligent assure la synchronisation des fichiers entre clients et serveur :

- Si un client demande un fichier non disponible localement, il le demande au serveur via RPC (`locationTry`).
- Si le serveur ne trouve pas un fichier, il diffuse un événement `missing-file-needed` à tous les clients connectés.
- Les clients qui possèdent le fichier le fournissent automatiquement au serveur.
- Les fichiers manquants sont automatiquement détectés et récupérés via un système de vérification périodique (CRON, piloté par `goblin-chronomancer`).

### Gold : abstraction haut niveau au-dessus de Chest

`Gold` simplifie l'usage du coffre pour des fichiers identifiés par un chemin logique (`goldIdFromFile` / `fileFromGoldId`, avec encodage `SmartId` de chaque segment de chemin). Chaque `Gold` référence un unique `ChestAlias` courant (`state.chestAliasId`).

- `provide(filePath)` fournit (ou met à jour) le fichier associé depuis un chemin disque ; si le fichier n'a pas changé (même hash), seule la republication logique est effectuée pour éviter une nouvelle génération inutile.
- `update(data)` permet une mise à jour directe avec des données en mémoire. Si un dépôt `GoldWarden` est disponible, l'écriture se fait directement sur disque (le `GoldWarden` détectera le changement) ; sinon la donnée est fournie au `Chest` comme un nouveau flux.
- `beforePersistOnServer()` (hook appelé avant la persistance côté serveur) répercute l'état courant du Gold dans le dépôt Git surveillé par le `GoldWarden` (écriture ou suppression du fichier correspondant).
- `retrieve()` retourne l'emplacement du fichier associé ; en l'absence d'alias courant, un mécanisme de repli utilise le partage en lecture seule (`gold.readonlyShare`) si le `GoldWarden` est désactivé.

### GoldWarden : surveillance automatique

Le `GoldWarden` surveille un répertoire (`chokidar`) représentant un dépôt de fichiers Gold, qu'il s'agisse d'un répertoire local de développement (`share` à la racine du projet) ou d'un clone d'un dépôt Git distant (`gold.git.remote`).

- À chaque ajout/modification de fichier détecté, l'acteur `Gold` correspondant est créé/mis à jour (`provide`).
- À chaque suppression, l'acteur `Gold` correspondant est mis à la corbeille (`trash`).
- Une fois la phase de démarrage terminée (`ready`), tous les `Gold` connus en base qui n'ont pas été vus pendant l'initialisation sont considérés comme supprimés et mis à la corbeille (`_trashGolds`).
- Seuls les fichiers appartenant à un namespace autorisé (`gold.namespaces`) sont pris en compte ; les autres sont ignorés par `chokidar`.
- Lorsqu'un dépôt Git distant est configuré, une tâche Chronomancer (`goldWardenGit`, planifiée via `gold.git.time`) déclenche périodiquement `_gitSync` : `checkout`/`pull` de la branche courante, `add`/`rm` des fichiers en attente de staging, puis `commit` et `push` (sauf en développement) si des changements sont détectés. La branche cible est `master` en développement, ou dérivée de la version de l'application (`major.minor`) en production.
- Les changements Git sont regroupés (`debounce` d'une seconde) afin d'éviter des synchronisations trop fréquentes lors de rafales d'écritures.

## Exemples d'utilisation

### Stocker un fichier dans le coffre

```javascript
// Dans une méthode d'un acteur Elf
async storeFile(xcraftStream, fileName) {
  const chest = new Chest(this);

  // Stocker le fichier dans le coffre
  const chestObjectId = await chest.supply(
    xcraftStream,
    fileName
  );

  return chestObjectId;
}
```

### Stocker un fichier avec alias

```javascript
// Dans une méthode d'un acteur Elf
async storeFileWithAlias(xcraftStream, fileName, namespace, alias) {
  const chest = new Chest(this);

  // Stocker le fichier dans le coffre avec un alias
  const chestAliasId = await chest.supply(
    xcraftStream,
    fileName,
    null,        // streamId
    null,        // chestObjectId
    null,        // cert
    namespace,   // namespace
    alias        // alias
  );

  return chestAliasId;
}
```

### Récupérer un fichier du coffre

```javascript
// Dans une méthode d'un acteur Elf
async retrieveFile(chestObjectId, outputPath) {
  const chest = new Chest(this);

  // Récupérer le fichier du coffre et le sauvegarder
  await chest.saveAsTry(chestObjectId, outputPath);
}
```

### Initialiser le coffre en mode réplica

```javascript
// Dans une méthode d'un acteur Elf, par exemple au boot de l'application
async bootChestReplica() {
  const chest = new Chest(this);
  await chest.init({replica: true});
}
```

### Utiliser Gold pour la gestion simplifiée

```javascript
// Dans une méthode d'un acteur Elf
async updateGoldFile(goldId, data) {
  const feedId = await this.newQuestFeed();
  const gold = await new Gold(this).create(goldId, feedId);

  // Met à jour le contenu Gold (crée un nouvel alias si le contenu a changé)
  const success = await gold.update(data);
  return success;
}
```

### Rechercher des fichiers par namespace

```javascript
// Dans une méthode d'un acteur Elf
async listDocuments(namespace, depth = 1) {
  const chest = new Chest(this);

  // Récupérer tous les alias dans un namespace spécifique
  const aliasGroups = await chest.getAliasIdsFromNamespace(namespace, depth);

  // Traiter les résultats - chaque groupe contient les versions ordonnées
  return aliasGroups.map(group => {
    // Le premier élément de chaque groupe est la version la plus récente
    return group[0];
  });
}
```

### Utiliser GoldFs pour l'accès aux fichiers Gold

```javascript
// Dans une méthode d'un acteur Elf
async readGoldFile(location) {
  const GoldFs = require('./lib/goldFs.js');
  const goldFs = new GoldFs(this);

  // Lire un fichier Gold comme un fichier système normal
  const content = await goldFs.readFile(location, 'utf8');
  return content;
}
```

## Interactions avec d'autres modules

- **[goblin-chronomancer]** : Utilisé pour planifier des tâches périodiques (vérification des fichiers manquants, collecte des orphelins, synchronisation Git du `GoldWarden`).
- **[xcraft-core-goblin]** : Fournit l'infrastructure Elf pour les acteurs, la gestion des états et la persistance Cryo.
- **[xcraft-core-stones]** : Utilisé pour la définition des types de données (shapes) et leur validation.
- **[xcraft-core-utils]** : Fournit des utilitaires pour les fichiers, les verrous (`locks`) et les checksums (`file-crypto`).
- **[xcraft-core-etc]** : Gère le chargement de la configuration du module (`config.js`).
- **[xcraft-core-fs]** : Utilisé pour le listage récursif de fichiers dans le backend `fs`.
- **[xcraft-core-host]** : Fournit la clé de routage des streams ainsi que les chemins/informations de l'application (`projectPath`, `appConfigPath`, `appVersion`).

## Configuration avancée

| Option                      | Description                                                     | Type   | Valeur par défaut |
| --------------------------- | --------------------------------------------------------------- | ------ | ----------------- |
| `backend`                   | Backend pour le stockage                                        | string | `fs`              |
| `fs.location`               | Emplacement pour stocker les fichiers                           | string | `null`            |
| `fs.maxSize`                | Taille maximale pour le stockage (0 = pas de limite)            | number | `0`               |
| `fs.cipher`                 | Algorithme de chiffrement par défaut                            | string | `aes-256-cbc`     |
| `fs.compress`               | Algorithme de compression par défaut                            | string | `gzip`            |
| `collect.orphans.maxSize`   | Taille maximale des orphelins à conserver                       | number | `0`               |
| `chronomancer.missing.time` | Planification CRON pour la vérification des fichiers manquants  | string | `0 */1 * * *`     |
| `chronomancer.collect.time` | Planification CRON pour la collecte des fichiers à la corbeille | string | `42 3 * * *`      |
| `gold.readonlyShare`        | Module pour le partage en lecture seule                         | string | `null`            |
| `gold.git.remote`           | Remote pour le dépôt Git du partage                             | string | `null`            |
| `gold.git.time`             | Planification CRON pour la synchronisation Git                  | string | `*/5 * * * *`     |
| `gold.namespaces`           | Espaces de noms supportés pour le Gold Warden                   | array  | `[]`              |

### Variables d'environnement

| Variable   | Description                                                                                                                                                      | Exemple       | Valeur par défaut |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------- |
| `NODE_ENV` | Environnement d'exécution. En `development`, le `GoldWarden` cible le répertoire `share` du projet et utilise la branche Git `master`, sans effectuer de `push`. | `development` | -                 |

## Détails des sources

### `chest.js`

L'acteur principal `Chest` est un singleton (`Elf.Alone`) qui orchestre toutes les opérations de stockage et de récupération. Il gère la synchronisation client-serveur, la collecte des fichiers orphelins et la vérification des fichiers manquants.

#### État et modèle de données

`ChestShape` est minimal (un simple `id`), car `Chest` agit principalement comme orchestrateur et ne persiste pas d'état métier propre.

La classe `ChestOptions` décrit les options acceptées par `init` :

- `replica` (booléen optionnel) : force le mode réplica (pas de limite de taille, tâches de synchronisation actives).
- `goldWarden` (booléen optionnel) : indique si le `GoldWarden` doit être actif.
- `goldPath` (string optionnel) : chemin du dépôt surveillé par le `GoldWarden`.
- `gitRemote` (string optionnel) : URL du dépôt Git distant pour le `GoldWarden`.

#### Méthodes publiques

- **`init(options)`** — Initialise le coffre : charge le backend configuré, détermine le rôle client/serveur à partir de `actionsSync.enable`, souscrit à l'événement de fichiers manquants côté client, active le mode réplica si nécessaire, puis lance un premier nettoyage (`_collect`).
- **`setReplica(enable)`** — Active ou désactive le mode réplica : ajuste la limite de taille du backend et démarre/arrête les tâches Chronomancer `chest` (vérification des manquants) et `chestCollect` (collecte des orphelins).
- **`supply(xcraftStream, fileName, streamId, chestObjectId, cert, namespace, alias)`** — Stocke un fichier dans le coffre. Retourne l'ID du `ChestObject` ou du `ChestAlias` si un namespace est spécifié. Gère automatiquement le chiffrement si un certificat est fourni, et protège les appels concurrents pour un même `chestObjectId` via un verrou.
- **`retrieve(chestObjectId, key)`** — Récupère un fichier du coffre sous forme de stream Xcraft. Gère automatiquement le déchiffrement si une clé privée est fournie.
- **`location(chestObjectId)`** — Obtient l'emplacement physique d'un fichier sur le système de fichiers local.
- **`locationTry(chestObjectId)`** — Tente d'obtenir l'emplacement avec synchronisation automatique : demande au serveur si le fichier est absent localement (côté client), ou tente de récupérer le fichier auprès des clients connectés en répétant l'opération (côté serveur), avec abandon après un nombre défini de tentatives.
- **`saveAsTry(chestObjectId, outputFile, privateKey)`** — Sauvegarde un fichier vers le système de fichiers avec déchiffrement automatique si nécessaire.
- **`exists(chestObjectId, filePath)`** — Vérifie si un fichier existe en comparant son hash avec celui du `ChestObject`.
- **`trash(chestObjectId)`** — Met un fichier à la corbeille et supprime le fichier physique du backend.
- **`unlink(chestObjectId)`** — Dissocie un fichier (garde l'entrée en base, supprime le fichier physique).
- **`trashAlias(chestAliasId)`** — Met un alias à la corbeille.
- **`setVectors(chestObjectId, vectors)`** — Définit des vecteurs pour la recherche vectorielle sur un objet.
- **`checkMissing(chestObjectId)`** — Vérifie l'existence physique du fichier et diffuse un événement réseau `missing-file-needed` si celui-ci est absent.
- **`getObjectIdFromName(name)`** — Récupère l'ID de la dernière version (génération la plus élevée) d'un fichier par nom.
- **`getObjectIdHistoryFromName(name, limit=10)`** — Récupère l'historique des versions d'un fichier (10 versions par défaut).
- **`getAliasIdsFromNamespace(namespace, depth=1)`** — Liste les alias dans un namespace, groupés par nom, avec support de l'historique des versions (les entrées les plus récentes en premier).

Les méthodes privées `_collect`, `_collectOrphans` et `_checkForMissing` assurent respectivement le nettoyage des fichiers physiques dont l'état est `trashed`/`unlinked`, la détection et mise à la corbeille des `ChestObject` non référencés, et la vérification périodique de la disponibilité des fichiers connus.

### `chestObject.js`

Représente un fichier individuel stocké dans le coffre avec ses métadonnées complètes.

#### État et modèle de données

La structure `ChestObjectShape` comprend : un identifiant (`id`), des métadonnées système (`meta`), le nom (`name`) et l'extension (`ext`) du fichier, sa taille (`size`), son type MIME (`mime`) et son charset, des informations de chiffrement optionnelles (`encryption`), son statut de lien (`link` : `linked` ou `unlinked`), un numéro de génération (`generation`) et des métadonnées documentaires optionnelles (`metadata`).

Les métadonnées système (`meta`) incluent un index de recherche, des vecteurs optionnels pour la recherche vectorielle (`vectors`, un dictionnaire nom → tableau de nombres) et un statut (`published` ou `trashed`).

Les informations de chiffrement (`encryption`) précisent l'algorithme de chiffrement (`aes-256-cbc`), l'algorithme de compression (`gzip`) et la clé symétrique chiffrée (`key`).

Les métadonnées documentaires optionnelles (`metadata`) permettent de décrire un titre, un sujet, une description, des langues, des dates de création/modification, des auteurs, des contributeurs et une version.

#### Méthodes publiques

- **`create(id, desktopId, filePath)`** — Crée un nouvel objet dans le coffre ; un chemin de fichier est obligatoire, dont le nom est assaini (`sanitizeName`) et l'extension déduite automatiquement (extension du nom, sinon du type MIME).
- **`upsert(size, mime, charset, cipher, compress, key)`** — Met à jour les informations du fichier avec incrémentation automatique de génération (à partir de la génération maximale connue). Persiste automatiquement l'objet.
- **`setMetadata(metadata)`** — Définit des métadonnées documentaires optionnelles (titre, auteurs, etc.).
- **`setAlias(namespace, name)`** — Crée un alias pour l'objet dans un namespace spécifique. Retourne l'ID du `ChestAlias` créé.
- **`setVectors(vectors)`** — Définit des vecteurs pour la recherche vectorielle.
- **`unlink()`** — Dissocie l'objet (garde l'entrée en base, marque comme `unlinked`).
- **`trash()`** — Met l'objet à la corbeille et met également à la corbeille tous les alias qui le référencent.

Le hook `beforePersistOnServer` s'assure, avant la persistance côté serveur, que le fichier physique correspondant est disponible (en déclenchant, si besoin, une demande de fichier manquant via `Chest.checkMissing`).

### `chestAlias.js`

Permet de référencer un `ChestObject` via un alias nommé dans un namespace organisé (format d'identifiant `chestAlias@{namespace}@{chestObjectId}`).

#### État et modèle de données

`ChestAliasShape` comprend un identifiant (`id`), des métadonnées système (`meta`, avec un index de recherche et un statut `published`/`trashed`) et un nom (`name`).

#### Méthodes publiques

- **`create(id, desktopId, name)`** — Crée un nouvel alias ; le nom est obligatoire.
- **`upsert(name)`** — Met à jour l'alias avec un nouveau nom et le marque comme `published`.
- **`trash()`** — Met l'alias à la corbeille.

### `gold.js`

L'acteur `Gold` fournit une interface simplifiée pour gérer des fichiers identifiés par un chemin logique, avec un cycle de vie automatisé et un alias intégré (`ChestAlias`).

Les fonctions utilitaires `goldIdFromFile` et `fileFromGoldId` convertissent respectivement un chemin de fichier en identifiant `gold@...` (chaque segment de chemin étant encodé via `SmartId.encode`) et inversement, en rejetant les chemins relatifs (`..`).

#### État et modèle de données

`GoldShape` comprend un identifiant (`id`), une référence optionnelle vers un `ChestAlias` courant (`chestAliasId`) et des métadonnées système (`meta`, statut `published`/`trashed`).

#### Méthodes publiques

- **`create(id, desktopId)`** — Crée un nouvel acteur Gold ; l'ID doit correspondre à un chemin de fichier valide (vérifié via `fileFromGoldId`).
- **`retrieve()`** — Récupère l'emplacement du fichier associé. Si aucun alias n'est défini et que le `GoldWarden` est actif, retourne `null` (le fichier n'existe plus). Sinon, retombe sur le partage en lecture seule configuré (`gold.readonlyShare`) si disponible.
- **`provide(filePath)`** — Met à jour le fichier associé depuis un chemin sur disque. Optimise en vérifiant si le fichier a changé (comparaison de hash) avant de créer une nouvelle version ; ancien alias mis à la corbeille si un nouvel alias est créé.
- **`update(data)`** — Met à jour le fichier avec des données brutes (`Buffer`/`string`). Écrit directement dans le dépôt surveillé par le `GoldWarden` si celui-ci est disponible ; sinon fournit les données au `Chest` comme un nouveau flux. Retourne `false` si le Gold est vide (pas d'alias courant).
- **`trash()`** — Met le Gold et son alias associé à la corbeille.

Le hook `beforePersistOnServer` répercute, côté serveur, l'état courant (publié ou corbeille) dans le fichier correspondant du dépôt surveillé par le `GoldWarden`, lorsque celui-ci est actif.

### `goldFs.js`

La classe `GoldFs` fournit une interface façon système de fichiers pour accéder aux fichiers Gold.

#### Méthodes principales

- **`readdir(location)`** — Liste les fichiers et dossiers dans un répertoire Gold virtuel. Retourne un tableau de noms.
- **`readdirent(location)`** — Liste les fichiers et dossiers avec des objets `Dirent`, permettant de distinguer fichiers et répertoires.
- **`readFile(location, options)`** — Lit le contenu d'un fichier Gold avec les mêmes options que `fs.readFile`.
- **`readJSON(location, options)`** — Lit et parse un fichier JSON Gold.
- **`writeJSON(location, object, options)`** — Écrit un objet JavaScript au format JSON dans un fichier Gold, avec options de formatage (`replacer`, `spaces`).
- **`exists(location)`** — Vérifie si un fichier Gold existe dans la base de données.
- **`resolve(location)`** — Résout l'emplacement physique d'un fichier Gold sur le système de fichiers.

Cette classe permet d'utiliser les fichiers Gold comme s'ils étaient des fichiers système normaux, en masquant la complexité du système de stockage sous-jacent.

### `goldWarden.js`

Le `GoldWarden` est un singleton (`Elf.Alone`) qui surveille le système de fichiers (via `chokidar`) pour synchroniser automatiquement les acteurs Gold correspondants, avec une intégration Git optionnelle.

#### État et modèle de données

`GoldWardenShape` est minimal (un simple `id`), l'essentiel de l'état opérationnel (chemin surveillé, remote Git, staging, watcher) étant conservé en mémoire dans l'instance de l'acteur plutôt que persisté.

#### Méthodes publiques

- **`init(options)`** — Initialise la surveillance du système de fichiers (en mode développement, avec un dépôt Git distant, ou avec un chemin explicite).
- **`dispose()`** — Nettoie les ressources (ferme le watcher `chokidar`).
- **`repository()`** — Retourne le chemin du dépôt surveillé, ou `null` si désactivé.
- **`setGoldPath(goldPath)`** — Configure le chemin du dépôt à surveiller et redémarre la surveillance.
- **`setGitRemote(gitRemote)`** — Configure le dépôt Git distant et redémarre la surveillance.

#### Fonctionnement

Le `GoldWarden` :

- Détermine le chemin à surveiller : en mode développement côté serveur sans chemin explicite, il cible le répertoire `share` à la racine du projet ; sinon, si un remote Git est configuré et le binaire `git` disponible, il clone/synchronise ce remote dans `var/share` (sous le répertoire de configuration de l'application).
- Compare, lors d'une resynchronisation, le remote Git existant localement avec celui configuré : en cas de divergence, le répertoire local est supprimé pour repartir d'un clone propre.
- Planifie une tâche Chronomancer (`goldWardenGit`) pour synchroniser périodiquement le dépôt Git (`checkout`, `pull`, staging des fichiers en attente, `commit`, puis `push` sauf en développement).
- Surveille (`chokidar`) le répertoire cible en ignorant les fichiers hors des namespaces configurés (`gold.namespaces`).
- Sur ajout/modification (`add`/`change`) : crée/met à jour l'acteur `Gold` correspondant (`provide`) et l'ajoute au staging Git (`add`) si un dépôt Git est actif.
- Sur suppression (`unlink`) : met à la corbeille l'acteur `Gold` correspondant (`trash`) et l'ajoute au staging Git (`rm`).
- Une fois l'initialisation terminée (`ready`), met à la corbeille tous les `Gold` connus en base qui n'ont pas été rencontrés pendant le balayage initial (fichiers supprimés hors ligne).
- Regroupe les synchronisations Git via un `debounce` d'une seconde pour éviter des commits trop fréquents.
- Détermine la branche Git cible via `gitBranch()` : `master` en développement, sinon les deux premiers segments (`major.minor`) de la version de l'application.

### `backend/fs.js`

Le backend par défaut implémente un système de fichiers sécurisé avec hash (`SHFS` - Secure Hash File System).

#### Caractéristiques

- **Structure organisée** : Répertoires basés sur les 2 premiers caractères du hash SHA-256.
- **Index en mémoire** : Gestion efficace avec tri par heure d'accès (`atime`).
- **Rotation automatique** : Suppression des fichiers les plus anciens selon la limite de taille configurée.
- **Chiffrement AES-256-CBC** : Avec clés symétriques générées aléatoirement, chiffrées elles-mêmes avec une clé publique RSA fournie par l'appelant.
- **Compression GZIP** : Optionnelle, appliquée avant chiffrement pour réduire l'espace de stockage.
- **Détection de corruption** : Un fichier dont le hash recalculé ne correspond plus à son nom est déplacé vers un répertoire `corrupted` dédié.

#### Méthodes principales

- **`put(streamFS, cert)`** — Stocke un fichier avec chiffrement optionnel. Retourne le hash, la taille et les informations de chiffrement.
- **`get(hash, encryption, key)`** — Récupère un fichier avec déchiffrement optionnel. Retourne un stream de lecture.
- **`exists(hash)`** — Vérifie l'existence et l'intégrité d'un fichier dans le stockage (déplace le fichier vers `corrupted` s'il est altéré).
- **`del(hash)`** — Supprime un fichier et met à jour l'index en mémoire.
- **`location(hash)`** — Calcule l'emplacement physique d'un fichier basé sur son hash.
- **`setMaxSize(maxSize)`** — Configure la limite de taille avec rotation automatique des anciens fichiers.
- **`hash(file)`** — Calcule le hash SHA-256 d'un fichier.
- **`getWriteStream()`** — Crée un stream d'écriture temporaire avec nom unique (UUID).
- **`onError(streamFS)`** — Nettoie les fichiers temporaires en cas d'erreur.
- **`list()`** — Itère sur tous les hash stockés dans l'index.

### `git/git.js`

Le module inclut une classe `Git`, un wrapper minimaliste autour du binaire `git` (localisé via `which`), utilisée par le `GoldWarden` pour synchroniser un dépôt distant.

#### Méthodes principales

- **`remoteUrl()`** — Récupère l'URL du dépôt distant configuré (`origin`).
- **`checkout(branch)`** — Change de branche dans le dépôt.
- **`clone(url, branch='master')`** — Clone un dépôt distant sur une branche spécifique.
- **`add(...files)`** — Ajoute des fichiers au staging.
- **`rm(...files)`** — Supprime des fichiers du staging et du système de fichiers (`git rm -f`).
- **`commit()`** — Valide les modifications avec un message automatique (« Update files »).
- **`pull()`** — Récupère les modifications depuis le dépôt distant (`git pull -f`).
- **`push()`** — Pousse les modifications vers le dépôt distant.
- **`fetch()`** — Récupère toutes les références distantes (`git fetch --all`).
- **`reset(branch)`** — Remet le dépôt dans un état propre sur une branche distante spécifique (ou `HEAD`).
- **`staged()`** — Vérifie s'il y a des modifications en staging (via `git diff --cached --quiet`).
- **`Git.available`** (statique) — Indique si le binaire `git` est disponible sur le système.

Chaque commande Git est exécutée dans un processus enfant (`spawn`) avec la variable d'environnement `LANG=C` afin d'obtenir des messages cohérents, et rejette la promesse en cas d'erreur ou de code de sortie non nul.

### Tests

#### `test/chestObject.spec.js`

Le module inclut des tests unitaires pour valider le comportement de la logique de `ChestObject`.

**Tests disponibles :**

- **Création** : Validation de la création d'objets avec noms de fichiers.
- **Mise à jour** : Tests des métadonnées, du chiffrement (uniquement appliqué si `cipher` et `key` sont tous deux fournis) et de la génération.
- **Cycle de vie** : Tests de dissociation (`unlink`) et de mise à la corbeille (`trash`).

Les tests utilisent `Elf.trial()` pour tester la logique sans persistance, permettant de valider le comportement des mutations d'état.

#### `test/goldWarden.spec.js`

Tests d'intégration pour le `GoldWarden` qui valident, sur un répertoire de test réel :

- **Surveillance des fichiers** : Détection automatique des ajouts et suppressions de répertoires/fichiers de workflows.
- **Gestion des namespaces** : Filtrage correct selon la configuration.
- **Synchronisation** : Création et suppression automatique des acteurs Gold correspondants, avec des délais d'attente adaptés à la latence de détection de `chokidar`.

Ces tests utilisent un `Elf.Runner` dédié et valident le comportement en temps réel du système de surveillance.

### Fichiers de test

#### `test/share/workflows/test-workflow/index.js`

Fichier de test minimal utilisé par les tests du `GoldWarden` pour valider la détection et la synchronisation des fichiers dans les namespaces configurés.

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

_Ce contenu a été généré par IA_

---

[goblin-chronomancer]: https://github.com/Xcraft-Inc/goblin-chronomancer
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
