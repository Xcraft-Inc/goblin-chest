# 📘 Documentation du module goblin-chest

## Aperçu

Le module `goblin-chest` est un système de stockage de fichiers avancé pour l'écosystème Xcraft. Il fournit une solution complète pour gérer le cycle de vie des fichiers avec des fonctionnalités de chiffrement, compression, versionnement et aliasing. Ce module agit comme un coffre-fort sécurisé pour les fichiers, permettant leur stockage, récupération et gestion efficace dans une application Xcraft.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module s'articule autour de cinq acteurs Elf principaux :

1. **Chest** - L'acteur principal singleton qui orchestre le stockage et la récupération des fichiers
2. **ChestObject** - Représente un fichier individuel stocké dans le coffre avec ses métadonnées
3. **ChestAlias** - Permet de créer des références nommées vers des ChestObjects dans des espaces de noms spécifiques
4. **Gold** - Gère les fichiers avec un cycle de vie simplifié et des alias automatiques
5. **GoldWarden** - Surveille le système de fichiers pour synchroniser automatiquement les fichiers Gold

Le module utilise un système de backend configurable pour le stockage physique des fichiers, avec une implémentation par défaut basée sur le système de fichiers (`fs`).

## Fonctionnement global

### Stockage et récupération

Lorsqu'un fichier est fourni au coffre via la méthode `supply` :

1. Le fichier est temporairement stocké via un stream d'écriture
2. Un hash SHA-256 est calculé pour identifier de manière unique le fichier
3. Le fichier est déplacé vers un emplacement permanent basé sur son hash (structure de répertoires avec les 2 premiers caractères du hash)
4. Un objet `ChestObject` est créé dans la base de données pour représenter le fichier avec ses métadonnées
5. Optionnellement, un alias peut être créé pour référencer ce fichier de manière plus conviviale

La récupération se fait via la méthode `retrieve` qui utilise l'ID du `ChestObject` pour localiser et retourner le fichier sous forme de stream.

### Gestion du cycle de vie

Le module gère automatiquement le cycle de vie des fichiers :

- Les fichiers peuvent être marqués comme "trashed" (mis à la corbeille)
- Les fichiers orphelins (non référencés) sont automatiquement collectés selon une planification CRON
- Les fichiers peuvent être "unlinked" (dissociés), ce qui signifie que l'entrée dans la base de données existe mais que le fichier physique peut être supprimé
- Un système de génération permet de gérer les versions successives des fichiers

### Chiffrement et compression

Le module offre des capacités de sécurité avancées :

- Chiffrement AES-256-CBC par défaut avec clés générées aléatoirement
- Compression GZIP par défaut
- Utilisation de clés publiques/privées pour le chiffrement asymétrique des clés symétriques
- Les clés symétriques et IV sont chiffrées avec la clé publique fournie

### Synchronisation client-serveur

Un mécanisme intelligent assure la synchronisation des fichiers entre clients et serveur :

- Si un client demande un fichier non disponible localement, il le demande au serveur via RPC
- Si le serveur ne trouve pas un fichier, il diffuse un événement `missing-file-needed` à tous les clients connectés
- Les clients qui possèdent le fichier le fournissent automatiquement au serveur
- Les fichiers manquants sont automatiquement détectés et récupérés via un système de vérification périodique (CRON)

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

- **[goblin-chronomancer]** : Utilisé pour planifier des tâches périodiques comme la vérification des fichiers manquants et la collecte des fichiers orphelins
- **[xcraft-core-goblin]** : Fournit l'infrastructure Elf pour les acteurs et la gestion des états
- **[xcraft-core-stones]** : Utilisé pour la définition des types de données et la validation
- **[xcraft-core-utils]** : Fournit des utilitaires pour les fichiers, les verrous et les checksums
- **[xcraft-core-etc]** : Gère la configuration du module
- **[xcraft-core-fs]** : Utilisé pour les opérations de listage de fichiers dans le backend
- **[xcraft-core-host]** : Fournit les clés de routage pour les streams et les informations de projet

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

| Variable   | Description                                                    | Exemple       | Valeur par défaut |
| ---------- | -------------------------------------------------------------- | ------------- | ----------------- |
| `NODE_ENV` | Environnement d'exécution (active GoldWarden si 'development') | `development` | -                 |

## Détails des sources

### `chest.js`

L'acteur principal `Chest` est un singleton (`Elf.Alone`) qui orchestre toutes les opérations de stockage et de récupération. Il gère la synchronisation client-serveur, la collecte des fichiers orphelins et la vérification des fichiers manquants.

#### État et modèle de données

```javascript
class ChestShape {
  id = string;
}
```

L'état du coffre est minimal car il s'agit principalement d'un orchestrateur.

#### Méthodes publiques

- **`init(options)`** — Initialise le coffre avec les options spécifiées. Configure le backend, détermine si on est côté client ou serveur, et configure les tâches de synchronisation.
- **`supply(xcraftStream, fileName, streamId, chestObjectId, cert, namespace, alias)`** — Stocke un fichier dans le coffre. Retourne l'ID du ChestObject ou du ChestAlias si un namespace est spécifié. Gère automatiquement le chiffrement si un certificat est fourni.
- **`retrieve(chestObjectId, key)`** — Récupère un fichier du coffre sous forme de stream Xcraft. Gère automatiquement le déchiffrement si une clé privée est fournie.
- **`location(chestObjectId)`** — Obtient l'emplacement physique d'un fichier sur le système de fichiers local.
- **`locationTry(chestObjectId)`** — Tente d'obtenir l'emplacement avec synchronisation automatique depuis le serveur si le fichier n'est pas disponible localement.
- **`saveAsTry(chestObjectId, outputFile, privateKey)`** — Sauvegarde un fichier vers le système de fichiers avec déchiffrement automatique si nécessaire.
- **`exists(chestObjectId, filePath)`** — Vérifie si un fichier existe en comparant son hash avec celui du ChestObject.
- **`trash(chestObjectId)`** — Met un fichier à la corbeille et supprime le fichier physique du backend.
- **`unlink(chestObjectId)`** — Dissocie un fichier (garde l'entrée DB, supprime le fichier physique).
- **`trashAlias(chestAliasId)`** — Met un alias à la corbeille.
- **`setVectors(chestObjectId, vectors)`** — Définit des vecteurs pour la recherche vectorielle sur un objet.
- **`setReplica(enable)`** — Active/désactive le mode réplica avec gestion automatique des tâches CRON.
- **`checkMissing(chestObjectId)`** — Vérifie et demande la récupération de fichiers manquants via événement réseau.
- **`getObjectIdFromName(name)`** — Récupère l'ID de la dernière version d'un fichier par nom.
- **`getObjectIdHistoryFromName(name, limit=10)`** — Récupère l'historique des versions d'un fichier (10 versions par défaut).
- **`getAliasIdsFromNamespace(namespace, depth=1)`** — Liste les alias dans un namespace avec support de l'historique des versions.

### `chestObject.js`

Représente un fichier individuel stocké dans le coffre avec ses métadonnées complètes.

#### État et modèle de données

```javascript
class ChestObjectShape {
  id = id('chestObject');
  meta = MetaShape;
  name = string;
  ext = option(string);
  size = number;
  mime = string;
  charset = string;
  encryption = option(EncryptionShape);
  link = enumeration('linked', 'unlinked');
  generation = number;
  metadata = option(MetadataShape);
}
```

**Métadonnées système :**

```javascript
class MetaShape {
  index = string;
  vectors = option(record(string, array(number))); // Pour la recherche vectorielle
  status = enumeration('published', 'trashed');
}
```

**Chiffrement :**

```javascript
class EncryptionShape {
  cipher = enumeration('aes-256-cbc');
  compress = enumeration('gzip');
  key = string; // Clé symétrique + IV chiffrées avec la clé publique
}
```

**Métadonnées documentaires :**

```javascript
class MetadataShape {
  title = option(string);
  subject = option(string);
  description = option(string);
  languages = option(array(string));
  createDate = option(dateTime);
  modifyDate = option(dateTime);
  authors = option(array(string));
  contributors = option(array(string));
  version = option(string);
}
```

#### Méthodes publiques

- **`create(id, desktopId, filePath)`** — Crée un nouvel objet dans le coffre (nom de fichier obligatoire).
- **`upsert(size, mime, charset, cipher, compress, key)`** — Met à jour les informations du fichier avec incrémentation automatique de génération. Persiste automatiquement l'objet.
- **`setMetadata(metadata)`** — Définit des métadonnées documentaires optionnelles (titre, auteurs, etc.).
- **`setAlias(namespace, name)`** — Crée un alias pour l'objet dans un namespace spécifique. Retourne l'ID du ChestAlias créé.
- **`setVectors(vectors)`** — Définit des vecteurs pour la recherche vectorielle.
- **`unlink()`** — Dissocie l'objet (garde l'entrée DB, marque comme 'unlinked').
- **`trash()`** — Met l'objet à la corbeille et supprime automatiquement tous les alias associés.

### `chestAlias.js`

Permet de référencer un `ChestObject` via un alias nommé dans un namespace organisé.

#### État et modèle de données

```javascript
class ChestAliasShape {
  id = string; // Format: chestAlias@{namespace}@{chestObjectId}
  meta = MetaShape;
  name = string;
}
```

#### Méthodes publiques

- **`create(id, desktopId, name)`** — Crée un nouvel alias (nom obligatoire).
- **`upsert(name)`** — Met à jour l'alias avec un nouveau nom et marque comme 'published'.
- **`trash()`** — Met l'alias à la corbeille.

### `gold.js`

L'acteur `Gold` fournit une interface simplifiée pour gérer des fichiers avec un cycle de vie automatisé et des alias intégrés.

#### État et modèle de données

```javascript
class GoldShape {
  id = id('gold');
  chestAliasId = option(id('chestAlias'));
  meta = MetaShape;
}
```

#### Méthodes publiques

- **`create(id, desktopId)`** — Crée un nouvel acteur Gold. L'ID doit correspondre à un chemin de fichier valide.
- **`retrieve()`** — Récupère l'emplacement du fichier associé. Gère automatiquement le fallback sur le partage en lecture seule si le GoldWarden est désactivé.
- **`provide(filePath)`** — Met à jour le fichier associé depuis un chemin sur disque. Optimise en vérifiant si le fichier a changé avant de créer une nouvelle version.
- **`update(data)`** — Met à jour le fichier avec des données brutes (Buffer/String). Supporte l'écriture directe dans le dépôt Git si le GoldWarden est actif. Retourne `false` si le Gold est vide.
- **`trash()`** — Met le Gold et son alias associé à la corbeille.

### `goldWarden.js`

Le `GoldWarden` est un singleton qui surveille le système de fichiers pour synchroniser automatiquement les fichiers Gold.

#### État et modèle de données

```javascript
class GoldWardenShape {
  id = string;
}
```

#### Méthodes publiques

- **`init(options)`** — Initialise la surveillance du système de fichiers (en mode développement ou avec un dépôt Git distant).
- **`dispose()`** — Nettoie les ressources (arrête la surveillance).
- **`repository()`** — Retourne le chemin du dépôt surveillé ou null si désactivé.
- **`setGoldPath(goldPath)`** — Configure le chemin du dépôt à surveiller et redémarre la surveillance.
- **`setGitRemote(gitRemote)`** — Configure le dépôt Git distant et redémarre la surveillance.

#### Fonctionnement

Le GoldWarden :

- Surveille le répertoire `share` du projet en mode développement
- Clone et synchronise un dépôt Git distant si configuré
- Détecte automatiquement les ajouts, modifications et suppressions de fichiers
- Crée/met à jour automatiquement les acteurs Gold correspondants
- Filtre les fichiers selon les namespaces configurés
- Génère des IDs Gold basés sur la structure de répertoires
- Gère la synchronisation Git avec staging automatique et commits périodiques
- Utilise des branches spécifiques selon l'environnement (master en développement, version en production)

### `goldFs.js`

La classe `GoldFs` fournit une interface similaire au système de fichiers pour accéder aux fichiers Gold.

#### Méthodes principales

- **`readdir(location)`** — Liste les fichiers et dossiers dans un répertoire Gold virtuel. Retourne un tableau de noms.
- **`readdirent(location)`** — Liste les fichiers et dossiers avec des objets Dirent pour distinguer fichiers et répertoires.
- **`readFile(location, options)`** — Lit le contenu d'un fichier Gold avec les mêmes options que fs.readFile.
- **`readJSON(location, options)`** — Lit et parse un fichier JSON Gold.
- **`exists(location)`** — Vérifie si un fichier Gold existe dans la base de données.
- **`resolve(location)`** — Résout l'emplacement physique d'un fichier Gold sur le système de fichiers.

Cette classe permet d'utiliser les fichiers Gold comme s'ils étaient des fichiers système normaux, en masquant la complexité du système de stockage sous-jacent.

### `backend/fs.js`

Le backend par défaut implémente un système de fichiers sécurisé avec hash (`SHFS` - Secure Hash File System).

#### Caractéristiques

- **Structure organisée** : Répertoires basés sur les 2 premiers caractères du hash SHA-256
- **Index en mémoire** : Gestion efficace avec tri par heure d'accès (atime)
- **Rotation automatique** : Suppression des fichiers les plus anciens selon la limite de taille
- **Chiffrement AES-256-CBC** : Avec clés générées aléatoirement
- **Compression GZIP** : Optionnelle pour réduire l'espace de stockage

#### Méthodes principales

- **`put(streamFS, cert)`** — Stocke un fichier avec chiffrement optionnel. Retourne le hash, la taille et les informations de chiffrement.
- **`get(hash, encryption, key)`** — Récupère un fichier avec déchiffrement optionnel. Retourne un stream de lecture.
- **`exists(hash)`** — Vérifie l'existence d'un fichier dans le stockage.
- **`del(hash)`** — Supprime un fichier et met à jour l'index en mémoire.
- **`location(hash)`** — Calcule l'emplacement physique d'un fichier basé sur son hash.
- **`setMaxSize(maxSize)`** — Configure la limite de taille avec rotation automatique des anciens fichiers.
- **`hash(file)`** — Calcule le hash SHA-256 d'un fichier.
- **`getWriteStream()`** — Crée un stream d'écriture temporaire avec nom unique.
- **`onError(streamFS)`** — Nettoie les fichiers temporaires en cas d'erreur.
- **`list()`** — Itère sur tous les hash stockés dans l'index.

### `git/git.js`

Le module inclut une classe `Git` pour gérer les dépôts Git du GoldWarden.

#### Méthodes principales

- **`checkout(branch)`** — Change de branche dans le dépôt.
- **`clone(url, branch='master')`** — Clone un dépôt distant avec une branche spécifique.
- **`add(...files)`** — Ajoute des fichiers au staging.
- **`rm(...files)`** — Supprime des fichiers du staging et du système de fichiers.
- **`commit()`** — Valide les modifications avec un message automatique.
- **`pull()`** — Récupère les modifications depuis le dépôt distant.
- **`push()`** — Pousse les modifications vers le dépôt distant.
- **`reset()`** — Remet le dépôt dans un état propre.
- **`staged()`** — Vérifie s'il y a des modifications en staging.

Cette classe permet au GoldWarden de synchroniser automatiquement les fichiers avec un dépôt Git distant, gérant le staging, les commits et la synchronisation bidirectionnelle.

### Tests

#### `test/chestObject.spec.js`

Le module inclut des tests unitaires pour valider le comportement des acteurs ChestObject.

**Tests disponibles :**

- **Création** : Validation de la création d'objets avec noms de fichiers
- **Mise à jour** : Tests des métadonnées, chiffrement et génération
- **Cycle de vie** : Tests de dissociation (`unlink`) et suppression (`trash`)
- **Chiffrement** : Validation des combinaisons cipher/key pour l'encryption

Les tests utilisent `Elf.trial()` pour tester la logique sans persistance, permettant de valider le comportement des mutations d'état.

#### `test/goldWarden.spec.js`

Tests d'intégration pour le GoldWarden qui valident :

- **Surveillance des fichiers** : Détection automatique des ajouts, modifications et suppressions
- **Gestion des namespaces** : Filtrage correct selon la configuration
- **Synchronisation** : Création et suppression automatique des acteurs Gold
- **Performance** : Tests avec timeouts adaptés selon l'environnement

Ces tests utilisent un répertoire de test temporaire et valident le comportement en temps réel du système de surveillance.

### Fichiers de test

#### `test/share/workflows/test-workflow/index.js`

Fichier de test minimal utilisé par les tests du GoldWarden pour valider la détection et la synchronisation des fichiers dans les namespaces configurés.

_Cette documentation a été mise à jour automatiquement à partir du code source._

[goblin-chronomancer]: https://github.com/Xcraft-Inc/goblin-chronomancer
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
