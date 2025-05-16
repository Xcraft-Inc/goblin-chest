# 📘 Documentation du module goblin-chest

## Aperçu

Le module `goblin-chest` est un système de stockage de fichiers avancé pour l'écosystème Xcraft. Il fournit une solution complète pour gérer le cycle de vie des fichiers avec des fonctionnalités de chiffrement, compression, versionnement et aliasing. Ce module agit comme un coffre-fort sécurisé pour les fichiers, permettant leur stockage, récupération et gestion efficace dans une application Xcraft.

## Structure du module

Le module s'articule autour de trois acteurs Elf principaux :

1. **Chest** - L'acteur principal qui orchestre le stockage et la récupération des fichiers
2. **ChestObject** - Représente un fichier individuel stocké dans le coffre avec ses métadonnées
3. **ChestAlias** - Permet de créer des références nommées vers des ChestObjects dans des espaces de noms spécifiques

Le module utilise un système de backend configurable pour le stockage physique des fichiers, avec une implémentation par défaut basée sur le système de fichiers (`fs`).

## Fonctionnement global

### Stockage et récupération

Lorsqu'un fichier est fourni au coffre via la méthode `supply` :

1. Le fichier est temporairement stocké
2. Un hash SHA-256 est calculé pour identifier de manière unique le fichier
3. Le fichier est déplacé vers un emplacement permanent basé sur son hash
4. Un objet `ChestObject` est créé dans la base de données pour représenter le fichier
5. Optionnellement, un alias peut être créé pour référencer ce fichier de manière plus conviviale

La récupération se fait via la méthode `retrieve` qui utilise l'ID du `ChestObject` pour localiser et retourner le fichier.

### Gestion du cycle de vie

Le module gère automatiquement le cycle de vie des fichiers :

- Les fichiers peuvent être marqués comme "trashed" (mis à la corbeille)
- Les fichiers orphelins (non référencés) sont automatiquement collectés selon une planification
- Les fichiers peuvent être "unlinked" (dissociés), ce qui signifie que l'entrée dans la base de données existe mais que le fichier physique peut être supprimé

### Chiffrement et compression

Le module offre des capacités de sécurité avancées :

- Chiffrement AES-256-CBC par défaut
- Compression GZIP par défaut
- Utilisation de clés publiques/privées pour le chiffrement asymétrique

### Synchronisation client-serveur

Un mécanisme intelligent assure la synchronisation des fichiers entre clients et serveur :

- Si un client demande un fichier non disponible localement, il le demande au serveur
- Si le serveur ne trouve pas un fichier, il diffuse une demande à tous les clients connectés
- Les fichiers manquants sont automatiquement détectés et récupérés via un système de vérification périodique

## Exemples d'utilisation

### Stocker un fichier dans le coffre

```javascript
const {Chest} = require('goblin-chest/lib/chest.js');

// Dans une méthode d'un acteur Elf
async storeFile(filePath) {
  const chest = new Chest(this);

  // Stocker le fichier dans le coffre
  const chestObjectId = await chest.supply(
    filePath,
    'myFileName'
  );

  return chestObjectId;
}

// Dans une méthode d'un acteur Elf
async storeFileFromStream(filePath) {
  const chest = new Chest(this);

  // Créer un stream à partir du fichier
  const fs = require('fs');
  const xcraftStream = fs.createReadStream(filePath);

  // Stocker le fichier dans le coffre avec un alias
  const chestObjectId = await chest.supply(
    xcraftStream,
    path.basename(filePath),
    null,
    null,
    null,
    'documents',  // namespace
    'contract'    // alias
  );

  return chestObjectId;
}
```

### Récupérer un fichier du coffre

```javascript
const {Chest} = require('goblin-chest/lib/chest.js');

// Dans une méthode d'un acteur Elf
async retrieveFile(chestObjectId, outputPath) {
  const chest = new Chest(this);

  // Récupérer le fichier du coffre et le sauvegarder
  await chest.saveAsTry(chestObjectId, outputPath);
}
```

### Créer un alias pour un fichier existant

```javascript
const {ChestObject} = require('goblin-chest/lib/chestObject.js');

// Dans une méthode d'un acteur Elf
async createAlias(chestObjectId, namespace, aliasName) {
  const feedId = await this.newQuestFeed();

  const object = await new ChestObject(this).create(chestObjectId, feedId);
  const aliasId = await object.setAlias(namespace, aliasName);

  return aliasId;
}
```

### Rechercher des fichiers par namespace

```javascript
const {Chest} = require('goblin-chest/lib/chest.js');

// Dans une méthode d'un acteur Elf
async listDocuments(namespace, depth = 1) {
  const chest = new Chest(this);

  // Récupérer tous les alias dans un namespace spécifique
  const aliasGroups = await chest.getAliasIdsFromNamespace(namespace, depth);

  // Traiter les résultats
  return aliasGroups.map(group => {
    // Le premier élément de chaque groupe est la version la plus récente
    return group[0];
  });
}
```

## Interactions avec d'autres modules

- **[goblin-chronomancer]** : Utilisé pour planifier des tâches périodiques comme la vérification des fichiers manquants et la collecte des fichiers orphelins
- **[xcraft-core-goblin]** : Fournit l'infrastructure Elf pour les acteurs et la gestion des états
- **[xcraft-core-stones]** : Utilisé pour la définition des types de données et la validation
- **[xcraft-core-utils]** : Fournit des utilitaires pour les fichiers, les verrous et les checksums
- **[xcraft-core-etc]** : Gère la configuration du module

## Configuration avancée

| Option | Description | Type | Valeur par défaut |
|--------|-------------|------|------------------|
| `backend` | Backend pour le stockage | string | `fs` |
| `fs.location` | Emplacement pour stocker les fichiers | string | `null` |
| `fs.maxSize` | Taille maximale pour le stockage (0 = pas de limite) | number | `0` |
| `fs.cipher` | Algorithme de chiffrement par défaut | string | `aes-256-cbc` |
| `fs.compress` | Algorithme de compression par défaut | string | `gzip` |
| `collect.orphans.maxSize` | Taille maximale des orphelins à conserver | number | `0` |
| `chronomancer.missing.time` | Planification CRON pour la vérification des fichiers manquants | string | `0 */1 * * *` |
| `chronomancer.collect.time` | Planification CRON pour la collecte des fichiers à la corbeille | string | `42 3 * * *` |

## Détails des sources

### `chest.js`

Ce fichier définit l'acteur principal `Chest` qui orchestre toutes les opérations de stockage et de récupération. Il initialise le backend approprié et expose les méthodes principales comme `supply`, `retrieve`, `trash`, etc.

L'acteur `Chest` est un singleton qui gère :

- L'initialisation du backend de stockage configuré
- La synchronisation des fichiers entre clients et serveur
- La gestion des fichiers orphelins via des tâches planifiées
- La vérification périodique des fichiers manquants

#### État et modèle de données

```javascript
class ChestShape {
  id = string;
}

class ChestState extends Elf.Sculpt(ChestShape) {}
```

#### Méthodes publiques

- **`init(options)`** - Initialise le coffre avec les options spécifiées. Peut être configuré en mode réplica.
- **`setReplica(enable)`** - Active ou désactive le mode réplica, qui modifie le comportement de stockage.
- **`supply(xcraftStream, fileName, streamId, chestObjectId, cert, namespace, alias)`** - Stocke un fichier dans le coffre et retourne son ID ou un alias.
- **`retrieve(chestObjectId, key)`** - Récupère un fichier du coffre en utilisant son ID.
- **`location(chestObjectId)`** - Obtient l'emplacement physique d'un fichier.
- **`locationTry(chestObjectId)`** - Tente d'obtenir l'emplacement d'un fichier, en le récupérant du serveur si nécessaire.
- **`saveAsTry(chestObjectId, outputFile, privateKey)`** - Sauvegarde un fichier du coffre vers un emplacement spécifié.
- **`setVectors(chestObjectId, vectors)`** - Définit des vecteurs pour un objet (utilisé pour la recherche).
- **`trashAlias(chestAliasId)`** - Met un alias à la corbeille.
- **`trash(chestObjectId)`** - Met un fichier à la corbeille.
- **`unlink(chestObjectId)`** - Dissocie un fichier (garde l'entrée dans la base de données mais permet de supprimer le fichier physique).
- **`checkMissing(chestObjectId)`** - Vérifie si un fichier est manquant et demande sa récupération si nécessaire.
- **`getObjectIdFromName(name)`** - Récupère l'ID d'un objet à partir de son nom.
- **`getObjectIdHistoryFromName(name, limit)`** - Récupère l'historique des versions d'un objet à partir de son nom.
- **`getAliasIdsFromNamespace(namespace, depth)`** - Récupère les alias dans un namespace spécifique.

### `chestObject.js`

Ce fichier définit l'acteur `ChestObject` qui représente un fichier stocké dans le coffre. Il gère les métadonnées du fichier et son cycle de vie.

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
  link = enumeration(
    'linked',
    'unlinked'
  );
  generation = number;
  metadata = option(MetadataShape);
}
```

Les métadonnées optionnelles peuvent inclure :

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

- **`create(id, desktopId, filePath)`** - Crée un nouvel objet dans le coffre.
- **`upsert(size, mime, charset, cipher, compress, key)`** - Met à jour les informations d'un objet.
- **`setMetadata(metadata)`** - Définit des métadonnées pour un objet.
- **`setAlias(namespace, name)`** - Crée un alias pour un objet.
- **`setVectors(vectors)`** - Définit des vecteurs pour un objet.
- **`unlink()`** - Dissocie un objet.
- **`trash()`** - Met un objet à la corbeille.

### `chestAlias.js`

Ce fichier définit l'acteur `ChestAlias` qui permet de référencer un `ChestObject` via un alias nommé dans un namespace. Cela permet d'avoir des noms conviviaux et organisés pour les fichiers.

#### État et modèle de données

```javascript
class ChestAliasShape {
  id = string;
  meta = MetaShape;
  name = string;
}

class MetaShape {
  index = string;
  status = enumeration('published', 'trashed');
}
```

#### Méthodes publiques

- **`create(id, desktopId, name)`** - Crée un nouvel alias.
- **`upsert(name)`** - Met à jour un alias.
- **`trash()`** - Met un alias à la corbeille.

### `backend/fs.js`

Ce fichier implémente le backend de stockage basé sur le système de fichiers. Il gère :

- Le stockage physique des fichiers dans une structure organisée
- Le chiffrement et le déchiffrement des fichiers
- La compression et la décompression
- La gestion de l'espace de stockage avec des limites configurables

La classe `SHFS` (Secure Hash File System) fournit les méthodes suivantes :

- **`setMaxSize(maxSize)`** - Définit la taille maximale du stockage.
- **`location(hash)`** - Obtient l'emplacement physique d'un fichier à partir de son hash.
- **`getWriteStream()`** - Crée un stream d'écriture pour un nouveau fichier.
- **`put(streamFS, cert)`** - Stocke un fichier dans le backend.
- **`del(hash)`** - Supprime un fichier du backend.
- **`get(hash, encryption, key)`** - Récupère un fichier du backend.
- **`exists(hash)`** - Vérifie si un fichier existe dans le backend.
- **`list()`** - Liste tous les fichiers dans le backend.

Le backend utilise une structure de répertoires basée sur les deux premiers caractères du hash SHA-256 des fichiers pour un accès efficace. Il implémente également un système de rotation des fichiers basé sur leur date d'accès pour respecter les limites de taille configurées.

_Cette documentation a été mise à jour automatiquement._

[goblin-chronomancer]: https://github.com/Xcraft-Inc/goblin-chronomancer
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc